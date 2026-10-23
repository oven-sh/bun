import {
  engineFieldsOf,
  engineInitializerOf,
  engineRecordNameOf,
  engineStructNameOf,
  engineTypeOf,
  engineTypesInDependencyOrder,
  forwardDeclarationsOf,
  isComparable,
  payloadTypesOf,
  twoWordScalars,
} from "./cpp-types.ts";
import { blocks, braced, cppHeader, cppLiteral, cppSource, indent, indentation, inNamespace } from "./lines.ts";
import type { Field, Kind, Schema, SchemaRecord, SchemaType, Variant, VariantCase } from "./model.ts";
import { payloadWordsOf } from "./model.ts";
import type { EmitContext, OutputFile } from "./outputs.ts";

const leadingRecordsHeaderName = "AOTSchemaTypeRecords.h";

const recordIncludes = [
  '"AOTBuiltinIDTypes.h"',
  '"AOTSchemaEnums.h"',
  '"AOTSchemaIDs.h"',
  '"AOTWireRecords.h"',
  '"IterationKind.h"',
  '"TypedArrayType.h"',
  "<bit>",
  "<optional>",
  "<span>",
  "<wtf/OptionSet.h>",
  "<wtf/Variant.h>",
  "<wtf/Vector.h>",
];

function fieldDecl(field: Field): string {
  return `${engineTypeOf(field.kind, field.isOptional)} ${field.name}${engineInitializerOf(field)};`;
}

function isDouble(field: Field): boolean {
  return field.kind.tag === "Scalar" && field.kind.scalar === "Double";
}

// Two records are equal when they hold the same bits: 0 is not -0, and a NaN equals itself.
function comparisonOf(name: string, fields: readonly Field[]): string[] {
  if (!fields.some(isDouble)) return [`friend bool operator==(const ${name}&, const ${name}&) = default;`];
  const terms = fields.map(field =>
    isDouble(field)
      ? `std::bit_cast<uint64_t>(a.${field.name}) == std::bit_cast<uint64_t>(b.${field.name})`
      : `a.${field.name} == b.${field.name}`,
  );
  const lines = terms.map((term, index) =>
    index === 0 ? `${indentation}return ${term}` : `${indentation.repeat(2)}&& ${term}`,
  );
  lines[lines.length - 1] += ";";
  return [`friend bool operator==(const ${name}& a, const ${name}& b)`, "{", ...lines, "}"];
}

function engineStruct(name: string, fields: readonly Field[], hasComparison: boolean): string[] {
  const comparison = hasComparison ? comparisonOf(name, fields) : [];
  return [`struct ${name} {`, ...indent(blocks(fields.map(fieldDecl), comparison)), "};"];
}

function isComparableCase(variant: Variant, variantCase: VariantCase): boolean {
  return isComparable({
    tag: "Variant",
    variant: { ...variant, name: `${variant.name}::${variantCase.name}`, cases: [variantCase] },
  });
}

function engineVariant(variant: Variant): string[] {
  const name = variant.name;
  const caseNames = variant.cases.map(variantCase => variantCase.name);
  const caseStructs = variant.cases.flatMap(variantCase => {
    const caseName = variantCase.name;
    if (variantCase.fields.length === 0)
      return [`struct ${caseName} { friend bool operator==(const ${caseName}&, const ${caseName}&) = default; };`];
    return engineStruct(caseName, variantCase.fields, isComparableCase(variant, variantCase));
  });
  return [
    `struct ${name} {`,
    ...braced("enum class Kind : uint8_t", caseNames, "};", indentation),
    "",
    ...indent(caseStructs),
    "",
    `    using Cases = Variant<${caseNames.join(", ")}>;`,
    "",
    `    ${name}() = default;`,
    `    template<typename Case> requires (!std::is_same_v<std::remove_cvref_t<Case>, ${name}>)`,
    `    ${name}(Case&& value)`,
    "        : cases(std::forward<Case>(value))",
    "    {",
    "    }",
    "",
    "    Kind kind() const { return static_cast<Kind>(cases.index()); }",
    "    template<typename Case> bool is() const { return std::holds_alternative<Case>(cases); }",
    "    template<typename Case> const Case& as() const LIFETIME_BOUND { return std::get<Case>(cases); }",
    "    template<typename Case> Case& as() LIFETIME_BOUND { return std::get<Case>(cases); }",
    "    template<typename Case> const Case* tryAs() const LIFETIME_BOUND { return std::get_if<Case>(&cases); }",
    "    template<typename Case> Case* tryAs() LIFETIME_BOUND { return std::get_if<Case>(&cases); }",
    "",
    `    friend bool operator==(const ${name}&, const ${name}&) = default;`,
    "",
    "    Cases cases;",
    "};",
    `JS_EXPORT_PRIVATE ASCIILiteral nameOf(${name}::Kind);`,
  ];
}

function definitionsOf(types: readonly SchemaType[]): string[] {
  const declarations = forwardDeclarationsOf(types).map(type => `struct ${engineStructNameOf(type)};`);
  const definitions = types.map(type => {
    if (type.tag === "Variant") return engineVariant(type.variant);
    return engineStruct(engineRecordNameOf(type.record), engineFieldsOf(type.record), isComparable(type));
  });
  return inNamespace("Typed", blocks(declarations, ...definitions));
}

function schemaFileOf(type: SchemaType): string {
  return (type.tag === "Record" ? type.record : type.variant).file.path;
}

// The records of the first schema file depend on no later file, so they come first in dependency order and get a header of their own.
function recordsHeaders(schema: Schema): OutputFile[] {
  const types = engineTypesInDependencyOrder(schema);
  const firstOfOtherFile = types.findIndex(type => schemaFileOf(type) !== schemaFileOf(types[0]));
  const numberOfLeadingTypes = firstOfOtherFile < 0 ? types.length : firstOfOtherFile;
  return [
    {
      name: leadingRecordsHeaderName,
      lines: cppHeader(recordIncludes, definitionsOf(types.slice(0, numberOfLeadingTypes))),
    },
    {
      name: "AOTSchemaRecords.h",
      lines: cppHeader(
        [`"${leadingRecordsHeaderName}"`],
        [...definitionsOf(types.slice(numberOfLeadingTypes)), "", '#include "AOTSchemaPayloadWords.h"'],
      ),
    },
  ];
}

function payloadWordsHeader(schema: Schema): string[] {
  const specializations = payloadTypesOf(schema).map(type => {
    const name = engineStructNameOf(type);
    return [
      `template<> struct PayloadWords<${name}> {`,
      `    static constexpr unsigned count = ${payloadWordsOf(type)};`,
      `    JS_EXPORT_PRIVATE static ${name} decode(std::span<const uint32_t, count>);`,
      `    JS_EXPORT_PRIVATE static void encode(const ${name}&, std::span<uint32_t, count>);`,
      "};",
    ];
  });
  return cppHeader(['"AOTSchemaSupport.h"'], inNamespace("Typed", blocks(...specializations)));
}

function hasPayloadWordsCodec(kind: Kind): boolean {
  return kind.tag === "Record" || kind.tag === "Variant" || (kind.tag === "Scalar" && twoWordScalars.has(kind.scalar));
}

function decodeStatements(fields: readonly Field[], target: string, firstWord = 0): string[] {
  const statements: string[] = [];
  let word = firstWord;
  for (const field of fields) {
    const type = engineTypeOf(field.kind, field.isOptional);
    const value = hasPayloadWordsCodec(field.kind)
      ? `PayloadWords<${type}>::decode(words.subspan<${word}, ${field.payloadWords}>())`
      : `decodePayloadWord<${type}>(words[${word}])`;
    statements.push(`${target}.${field.name} = ${value};`);
    word += field.payloadWords;
  }
  return statements;
}

function encodeStatements(fields: readonly Field[], source: string, firstWord = 0): string[] {
  const statements: string[] = [];
  let word = firstWord;
  for (const field of fields) {
    const value = `${source}.${field.name}`;
    statements.push(
      hasPayloadWordsCodec(field.kind)
        ? `PayloadWords<${engineTypeOf(field.kind, field.isOptional)}>::encode(${value}, words.subspan<${word}, ${field.payloadWords}>());`
        : `words[${word}] = encodePayloadWord(${value});`,
    );
    word += field.payloadWords;
  }
  return statements;
}

function recordCodec(record: SchemaRecord): string[] {
  const name = engineRecordNameOf(record);
  return [
    `${name} PayloadWords<${name}>::decode(std::span<const uint32_t, count> words)`,
    "{",
    `    ${name} record;`,
    ...indent(decodeStatements(record.fields, "record")),
    "    return record;",
    "}",
    "",
    `void PayloadWords<${name}>::encode(const ${name}& record, std::span<uint32_t, count> words)`,
    "{",
    ...indent(encodeStatements(record.fields, "record")),
    "}",
  ];
}

function variantCodec(variant: Variant): string[] {
  const name = variant.name;
  const decode: string[] = [];
  const encode: string[] = [];
  for (const variantCase of variant.cases) {
    const label = `case ${name}::Kind::${variantCase.name}:`;
    const caseType = `${name}::${variantCase.name}`;
    if (variantCase.fields.length === 0) {
      decode.push(label, `    return ${caseType} { };`);
      encode.push(label, "    return;");
      continue;
    }
    decode.push(
      `${label} {`,
      `    ${caseType} value;`,
      ...indent(decodeStatements(variantCase.fields, "value", 1)),
      "    return value;",
      "}",
    );
    encode.push(
      `${label} {`,
      `    const auto& value = variant.as<${caseType}>();`,
      ...indent(encodeStatements(variantCase.fields, "value", 1)),
      "    return;",
      "}",
    );
  }
  return [
    `${name} PayloadWords<${name}>::decode(std::span<const uint32_t, count> words)`,
    "{",
    `    switch (static_cast<${name}::Kind>(words[0])) {`,
    ...indent(decode),
    "    }",
    "    RELEASE_ASSERT_NOT_REACHED();",
    "}",
    "",
    `void PayloadWords<${name}>::encode(const ${name}& variant, std::span<uint32_t, count> words)`,
    "{",
    "    std::ranges::fill(words, 0);",
    "    words[0] = static_cast<uint32_t>(variant.kind());",
    "    switch (variant.kind()) {",
    ...indent(encode),
    "    }",
    "    RELEASE_ASSERT_NOT_REACHED();",
    "}",
  ];
}

function caseNameFunction(variant: Variant): string[] {
  const names = variant.cases.map(variantCase => cppLiteral(variantCase.name));
  return [
    `ASCIILiteral nameOf(${variant.name}::Kind kind)`,
    "{",
    ...braced(`static constexpr std::array<ASCIILiteral, ${names.length}> names`, names, "};", indentation),
    "    RELEASE_ASSERT(static_cast<size_t>(kind) < names.size());",
    "    return names[static_cast<size_t>(kind)];",
    "}",
  ];
}

function recordsSource(schema: Schema): string[] {
  const variants = engineTypesInDependencyOrder(schema).flatMap(type => (type.tag === "Variant" ? [type.variant] : []));
  const codecs = payloadTypesOf(schema).map(type =>
    type.tag === "Record" ? recordCodec(type.record) : variantCodec(type.variant),
  );
  return cppSource(
    ['"AOTSchemaRecords.h"', "<algorithm>", "<array>"],
    inNamespace("Typed", blocks(...variants.map(caseNameFunction), ...codecs)),
  );
}

export function emitCppRecords(context: EmitContext): OutputFile[] {
  return [
    ...recordsHeaders(context.schema),
    { name: "AOTSchemaPayloadWords.h", lines: payloadWordsHeader(context.schema) },
    { name: "AOTSchemaRecords.cpp", lines: recordsSource(context.schema) },
  ];
}
