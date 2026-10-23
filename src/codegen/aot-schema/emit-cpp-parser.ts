import { engineFieldsOf, engineRecordNameOf, engineTypeOf, listFirstWord } from "./cpp-types.ts";
import { closureOfZeroTests, presenceTest, printedTypes, zeroFunctions } from "./emit-cpp-printer.ts";
import { caseWords, convertedTypes } from "./emit-cpp-reader.ts";
import {
  blocks,
  cppHeader,
  cppLiteral,
  cppSource,
  groupedCases,
  indent,
  indentation,
  inNamespace,
  type Lines,
} from "./lines.ts";
import type {
  Entry,
  Field,
  Kind,
  NestedKind,
  PayloadField,
  ScalarKind,
  Schema,
  SchemaRecord,
  SchemaType,
  Variant,
} from "./model.ts";
import { fieldsOf, innermostKindOf, isId, isNested, isWireType, nameOf, payloadWordsOf } from "./model.ts";
import { cppIdTypeName } from "./names.ts";
import type { EmitContext, OutputFile } from "./outputs.ts";
import { SchemaError } from "./source.ts";

const brackets = "TokenKind::LeftBracket, TokenKind::RightBracket";

const idValueParsers: ReadonlyMap<string, string> = new Map([
  ["LayoutSet", "parser.parseLayoutSet()"],
  ["CalleeSet", "parser.parseCalleeSet()"],
]);

const patchTranslators: ReadonlyMap<string, string> = new Map([["Type", "type"]]);

const scalarParsers: Readonly<Record<ScalarKind, string>> = {
  Bool: "parser.parseBool()",
  UInt8: "static_cast<uint8_t>(parser.parseUInt32(UINT8_MAX))",
  UInt32: "parser.parseUInt32()",
  UInt64: "parser.parseUInt64()",
  Int64: "parser.parseInt64()",
  Double: "parser.parseDouble()",
  Field: "parser.parseUInt32()",
  Byte: "parser.parseUInt32()",
  Word: "parser.parseUInt32()",
  CodeWord: "parser.parseUInt32()",
};

function hasEngineFields(kind: NestedKind): boolean {
  return kind.tag === "Record" && kind.record.hasEngineFields;
}

function recordsIn(types: readonly SchemaType[]): SchemaRecord[] {
  return types.flatMap(type => (type.tag === "Record" ? [type.record] : []));
}

function variantsIn(types: readonly SchemaType[]): Variant[] {
  return types.flatMap(type => (type.tag === "Variant" ? [type.variant] : []));
}

function parsedWireTypes(schema: Schema): SchemaType[] {
  return convertedTypes(schema).filter(type => !(type.tag === "Record" && type.record.isCustomText));
}

function parsedEngineTypes(schema: Schema): SchemaType[] {
  return printedTypes(schema).filter(type => !isWireType(type));
}

function parserHeader(schema: Schema): string[] {
  const wire = parsedWireTypes(schema);
  const engine = parsedEngineTypes(schema);
  const wireRecords = recordsIn(wire);
  const body = blocks(
    wireRecords.map(record => {
      const engineParameter = record.hasEngineFields ? `, ${engineRecordNameOf(record)}& engineFields` : "";
      return `void parseFields(TextParser&, Wire::${record.name}&${engineParameter});`;
    }),
    variantsIn(wire).map(variant => `void parseVariant(TextParser&, Wire::${variant.name}&);`),
    [
      ...recordsIn(engine).map(record => `void parseFields(TextParser&, ${engineRecordNameOf(record)}&);`),
      ...variantsIn(engine).map(variant => `void parseVariant(TextParser&, ${variant.name}&);`),
    ],
    wireRecords
      .filter(record => record.hasEngineFields)
      .map(record => engineRecordNameOf(record))
      .map(name => `void applyEngineFields(const PatchContext&, const ${name}& parsed, ${name}& target);`),
    ["void parseFields(TextParser&, Opcode);", "void parseFields(TextParser&, TerminatorKind);"],
  );
  return cppHeader([], inNamespace("Typed", body));
}

function parsedWord(kind: Kind): string {
  switch (kind.tag) {
    case "Id": {
      const value = idValueParsers.get(kind.id.name);
      if (value !== undefined) return `${value}.index()`;
      if (kind.id.record?.isCustomText) return `parser.parse${kind.id.name}Word()`;
      return kind.id.isEngine ? "parser.parseUInt32()" : `parser.parseIDWord(IDPrefix::${kind.id.name})`;
    }
    case "External":
      return kind.external.form === "id" ? `parser.parse${kind.external.name}().index()` : "parser.parseUInt32()";
    case "Enum":
      return `static_cast<uint32_t>(parser.parseEnumerator<${kind.type.name}>())`;
    case "Flags":
      return `parser.parseFlagWord<${kind.type.name}>()`;
    case "Scalar":
      return kind.scalar === "Bool" ? "static_cast<uint32_t>(parser.parseBool())" : "parser.parseUInt32()";
    case "PlacedWord":
      return "parser.parseUInt32()";
    case "Record":
    case "Variant":
    case "Span":
    case "List":
      throw new Error(`a ${kind.tag} is not one word`);
  }
}

function parsedBits(kind: Kind): string | null {
  if (kind.tag !== "Scalar") return null;
  if (kind.scalar === "Int64") return "static_cast<uint64_t>(parser.parseInt64())";
  if (kind.scalar === "UInt64") return "parser.parseUInt64()";
  if (kind.scalar === "Double") return "std::bit_cast<uint64_t>(parser.parseDouble())";
  return null;
}

function parsedValue(kind: Kind, inAbi = false): string {
  if (inAbi) {
    if (kind.tag === "Enum" && kind.type.isAbi) return `parser.parseEnumerator<${kind.type.name}>()`;
    if (kind.tag === "Flags" && kind.type.isAbi)
      return `static_cast<${kind.type.name}>(parser.parseFlagWord<${kind.type.name}>())`;
    if (kind.tag === "Scalar" && (kind.scalar === "UInt64" || kind.scalar === "UInt8"))
      return scalarParsers[kind.scalar];
    return parsedWord(kind);
  }
  switch (kind.tag) {
    case "Id":
      return idValueParsers.get(kind.id.name) ?? `${cppIdTypeName(kind.id.name)}(${parsedWord(kind)})`;
    case "External":
      return kind.external.form === "id"
        ? `parser.parse${kind.external.name}()`
        : `static_cast<${engineTypeOf(kind)}>(parser.parseUInt32())`;
    case "Enum":
      return `parser.parseEnumerator<${kind.type.name}>()`;
    case "Flags": {
      const set = engineTypeOf(kind);
      return `${set}::fromRaw(static_cast<${set}::StorageType>(parser.parseFlagWord<${kind.type.name}>()))`;
    }
    case "Scalar":
      return scalarParsers[kind.scalar];
    case "PlacedWord":
      return `${kind.word}(parser.parseUInt32())`;
    case "Record":
    case "Variant":
    case "Span":
    case "List":
      throw new Error(`a ${kind.tag} is not a scalar`);
  }
}

function conditional(test: string | null, body: Lines): string[] {
  if (test === null) return [...body];
  if (body.length === 1) return [`if (${test})`, indentation + body[0]];
  return [`if (${test}) {`, ...indent(body), "}"];
}

function guarded(name: string, body: Lines): string[] {
  return conditional(`parser.acceptField(${cppLiteral(name)})`, body);
}

function scoped(body: Lines): string[] {
  return ["{", ...indent(body), "}"];
}

function parsedList(body: Lines): string[] {
  return [`parser.parseList(${brackets}, [&] {`, ...indent(body), "});"];
}

function nestedCall(kind: NestedKind, wire: string, engine: string): string {
  if (kind.tag === "Variant") return `parseVariant(parser, ${wire});`;
  return `parser.parseRecord([&] { parseFields(parser, ${hasEngineFields(kind) ? `${wire}, ${engine}` : wire}); });`;
}

function engineNestedCall(kind: NestedKind, target: string): string {
  return kind.tag === "Variant"
    ? `parseVariant(parser, ${target});`
    : `parser.parseRecord([&] { parseFields(parser, ${target}); });`;
}

function parseWireSpan(field: Field, element: Kind, engine: string | null): string[] {
  if (element.tag === "Scalar" && element.scalar === "Byte") return ["Wire::Span span = parser.parseByteString();"];
  if (!isNested(element)) {
    return [
      "Vector<uint32_t> words;",
      ...parsedList([`words.append(${parsedWord(element)});`]),
      "Wire::Span span = parser.builder().appendWords(words.span());",
    ];
  }
  const name = nameOf(element);
  const hasEngine = hasEngineFields(element);
  if (hasEngine && engine === null) {
    throw new SchemaError(
      field.location,
      `field ${field.name}: a wire variant cannot hold ${name}, which has engine fields`,
    );
  }
  return [
    `Vector<Wire::${name}> elements;`,
    ...parsedList([
      `Wire::${name} element;`,
      ...(hasEngine ? [`${engineTypeOf(element)} engineElement;`] : []),
      nestedCall(element, "element", "engineElement"),
      "elements.append(element);",
      ...(hasEngine ? [`${engine}.append(WTF::move(engineElement));`] : []),
    ]),
    `Wire::Span span = parser.builder().appendRecords<Wire::${name}>(elements.span());`,
  ];
}

function parseWireField(field: Field): string[] {
  const kind = field.kind;
  const target = `wire.${field.name}`;
  const engine = `engineFields.${field.name}`;
  if (kind.tag === "Span")
    return guarded(field.name, [...parseWireSpan(field, kind.element, engine), `${target} = span;`]);
  if (isNested(kind)) return guarded(field.name, [nestedCall(kind, target, engine)]);
  if (kind.tag === "Scalar" && kind.scalar === "Int64")
    return guarded(field.name, [`${target} = parser.parseInt64();`]);
  return guarded(field.name, [`${target} = ${parsedBits(kind) ?? parsedWord(kind)};`]);
}

function parseEngineField(field: Field, base: string, inAbi: boolean): string[] {
  const kind = field.kind;
  const target = `${base}.${field.name}`;
  if (isNested(kind)) return guarded(field.name, [engineNestedCall(kind, target)]);
  if (kind.tag !== "Span" && kind.tag !== "List")
    return guarded(field.name, [`${target} = ${parsedValue(kind, inAbi)};`]);
  const element = kind.element;
  if (!isNested(element)) return guarded(field.name, parsedList([`${target}.append(${parsedValue(element)});`]));
  return guarded(
    field.name,
    parsedList([
      `${engineTypeOf(element)} element;`,
      engineNestedCall(element, "element"),
      `${target}.append(WTF::move(element));`,
    ]),
  );
}

function cppFunction(signature: string, body: Lines, parametersIfEmpty: Lines = []): string[] {
  return [
    signature,
    "{",
    ...indent(body.length > 0 ? body : parametersIfEmpty.map(parameter => `UNUSED_PARAM(${parameter});`)),
    "}",
  ];
}

function wireRecordFunction(record: SchemaRecord): string[] {
  const body = engineFieldsOf(record).flatMap(field =>
    field.isEngine ? parseEngineField(field, "engineFields", false) : parseWireField(field),
  );
  const engineParameter = record.hasEngineFields ? `, ${engineRecordNameOf(record)}& engineFields` : "";
  return cppFunction(`void parseFields(TextParser& parser, Wire::${record.name}& wire${engineParameter})`, body, [
    "parser",
    "wire",
  ]);
}

function wireCaseField(field: Field, word: number): string[] {
  const kind = field.kind;
  const low = `wire.words[${word}]`;
  const high = `wire.words[${word + 1}]`;
  if (kind.tag === "Span")
    return guarded(field.name, [
      ...parseWireSpan(field, kind.element, null),
      `${low} = span.start;`,
      `${high} = span.count;`,
    ]);
  const bits = parsedBits(kind);
  if (bits === null) return guarded(field.name, [`${low} = ${parsedWord(kind)};`]);
  return guarded(field.name, [
    `uint64_t bits = ${bits};`,
    `${low} = static_cast<uint32_t>(bits);`,
    `${high} = static_cast<uint32_t>(bits >> 32);`,
  ]);
}

function acceptedCase(name: string, body: Lines): string[] {
  return [`if (parser.acceptWord(${cppLiteral(name)})) {`, ...indent([...body, "return;"]), "}"];
}

function wireVariantFunction(schema: Schema, variant: Variant): string[] {
  const body = variant.cases.flatMap(variantCase => {
    const fields = caseWords(schema, variantCase.fields);
    const fieldStatements = fields.flatMap(([field, word]) => wireCaseField(field, word));
    return acceptedCase(variantCase.name, [
      `wire.kind = ${variantCase.number};`,
      ...fields.filter(([field]) => field.isOptional).map(([, word]) => `wire.words[${word}] = Wire::none;`),
      ...(fields.length > 0 ? ["parser.parseRecord([&] {", ...indent(fieldStatements), "});"] : []),
    ]);
  });
  return cppFunction(`void parseVariant(TextParser& parser, Wire::${variant.name}& wire)`, [...body, "parser.fail();"]);
}

function engineRecordFunction(record: SchemaRecord): string[] {
  const body = engineFieldsOf(record).flatMap(field => parseEngineField(field, "record", record.form === "abi"));
  return cppFunction(`void parseFields(TextParser& parser, ${engineRecordNameOf(record)}& record)`, body, [
    "parser",
    "record",
  ]);
}

function engineVariantFunction(variant: Variant): string[] {
  const body = variant.cases.flatMap(variantCase => {
    const caseType = `${variant.name}::${variantCase.name}`;
    if (variantCase.fields.length === 0) return acceptedCase(variantCase.name, [`variant = ${caseType} { };`]);
    return acceptedCase(variantCase.name, [
      `${caseType} value;`,
      "parser.parseRecord([&] {",
      ...indent(variantCase.fields.flatMap(field => parseEngineField(field, "value", false))),
      "});",
      "variant = WTF::move(value);",
    ]);
  });
  return cppFunction(`void parseVariant(TextParser& parser, ${variant.name}& variant)`, [...body, "parser.fail();"]);
}

function namesTypes(kind: Kind, seen: Set<SchemaRecord | Variant> = new Set()): boolean {
  const inner = innermostKindOf(kind);
  if (inner.tag === "Id") return patchTranslators.has(inner.id.name);
  if (!isNested(inner)) return false;
  const type = inner.tag === "Record" ? inner.record : inner.variant;
  if (seen.has(type)) return false;
  seen.add(type);
  return fieldsOf(inner).some(field => namesTypes(field.kind, seen));
}

function assignEngineField(kind: Kind, source: string, target: string): string[] {
  const translator = kind.tag === "Id" ? patchTranslators.get(kind.id.name) : undefined;
  if (translator !== undefined) return [`${target} = context.${translator}(${source}.index());`];
  const assignment = `${target} = ${source};`;
  if (!namesTypes(kind)) return [assignment];
  if (kind.tag !== "Span" && kind.tag !== "List")
    return [assignment, `forEachReference(${target}, TypeTranslator { context });`];
  const translation = isNested(kind.element)
    ? "forEachReference(element, TypeTranslator { context });"
    : "TypeTranslator { context }(element);";
  return [assignment, `for (auto& element : ${target})`, indentation + translation];
}

function applyFunction(schema: Schema, record: SchemaRecord): string[] {
  const body: string[] = [];
  let usesContext = false;
  for (const field of engineFieldsOf(record)) {
    const kind = field.kind;
    const source = `parsed.${field.name}`;
    const target = `target.${field.name}`;
    if (field.isEngine) {
      const isNullable = field.isOptional || isId(kind);
      usesContext ||= namesTypes(kind);
      body.push(
        ...conditional(
          presenceTest(schema, kind, isNullable, source, false, true),
          assignEngineField(kind, source, target),
        ),
      );
      continue;
    }
    const inner = innermostKindOf(kind);
    if (inner.tag !== "Record" || !inner.record.hasEngineFields || inner.record.isCustomEngine) continue;
    usesContext = true;
    if (kind.tag !== "Span") body.push(`applyEngineFields(context, ${source}, ${target});`);
    else
      body.push(
        `for (size_t i = 0; i < ${source}.size(); ++i)`,
        `${indentation}applyEngineFields(context, ${source}[i], ${target}[i]);`,
      );
  }
  if (!usesContext) body.unshift("UNUSED_PARAM(context);");
  const name = engineRecordNameOf(record);
  return cppFunction(
    `void applyEngineFields(const PatchContext& context, const ${name}& parsed, ${name}& target)`,
    body,
  );
}

const typeTranslator = `struct TypeTranslator {
    void operator()(TypeID& id) const { id = context.type(id.index()); }
    template<typename Reference, typename... Role> void operator()(Reference&, Role...) const { }

    const PatchContext& context;
};`.split("\n");

function recordParserSource(schema: Schema): string[] {
  const wire = parsedWireTypes(schema);
  const wireRecords = recordsIn(wire);
  const engineFieldKinds = wireRecords
    .flatMap(record => engineFieldsOf(record).filter(field => field.isEngine))
    .map(field => field.kind);
  const zeroTested = closureOfZeroTests(schema, new Set(engineFieldKinds.filter(isNested).map(kind => nameOf(kind))));
  const body = blocks(
    typeTranslator,
    ...zeroFunctions(schema, zeroTested),
    ...wire.map(type =>
      type.tag === "Record" ? wireRecordFunction(type.record) : wireVariantFunction(schema, type.variant),
    ),
    ...parsedEngineTypes(schema).map(type =>
      type.tag === "Record" ? engineRecordFunction(type.record) : engineVariantFunction(type.variant),
    ),
    ...wireRecords.filter(record => record.hasEngineFields).map(record => applyFunction(schema, record)),
  );
  return cppSource(['"AOTIRParserInternal.h"', '"AOTSchemaWalkers.h"', "<bit>"], inNamespace("Typed", body));
}

const entryHelpers = `struct PatchTarget {
    FunctionID function;
    BlockID block;
    ValueID value;
};

enum class PatchedWord : uint8_t { Unchanged, Type };

static Instruction& instructionAt(PatchContext& context, const PatchTarget& target)
{
    Function& function = context.program.at(target.function);
    if (target.value)
        return function.edit(target.value);
    return function.edit(target.block).terminator;
}

UNUSED_FUNCTION static void patchWord(TextParser& parser, const PatchTarget& target, unsigned word, uint32_t parsed, PatchedWord kind = PatchedWord::Unchanged)
{
    parser.addPatch([target, word, parsed, kind](PatchContext& context) {
        uint32_t translated = parsed;
        if (kind == PatchedWord::Type)
            translated = context.type(parsed).index();
        instructionAt(context, target).setPayloadWordAt(word, translated);
    });
}

UNUSED_FUNCTION static void patchWordPair(TextParser& parser, const PatchTarget& target, unsigned word, uint64_t parsed)
{
    parser.addPatch([target, word, parsed](PatchContext& context) {
        instructionAt(context, target).setPayloadWordPairAt(word, parsed);
    });
}

UNUSED_FUNCTION static void patchOperand(TextParser& parser, const PatchTarget& target, uint32_t operandIndex, uint32_t parsed)
{
    parser.addPatch([target, operandIndex, parsed](PatchContext& context) {
        instructionAt(context, target).setOperand(operandIndex, ValueID(parsed));
    });
}

template<typename Record>
static void patchRecord(TextParser& parser, const PatchTarget& target, unsigned firstWord, const Record& parsed)
{
    parser.addPatch([target, firstWord, parsed](PatchContext& context) {
        encodePayloadRecord(instructionAt(context, target), firstWord, parsed);
    });
}

template<typename Record>
static void patchEngineFields(TextParser& parser, const PatchTarget& target, unsigned firstWord, const Record& parsed)
{
    parser.addPatch([target, firstWord, parsed](PatchContext& context) {
        Instruction& instruction = instructionAt(context, target);
        auto record = decodePayloadRecord<Record>(instruction, firstWord);
        applyEngineFields(context, parsed, record);
        encodePayloadRecord(instruction, firstWord, record);
    });
}

template<typename Record>
static void patchEngineFieldsOfList(TextParser& parser, const PatchTarget& target, unsigned firstWord, Vector<Record>&& parsed)
{
    parser.addPatch([target, firstWord, parsed = WTF::move(parsed)](PatchContext& context) {
        Instruction& instruction = instructionAt(context, target);
        PayloadListView<Record> list(instruction.payloadListFrom(firstWord));
        Vector<Record> records;
        for (size_t i = 0; i < list.size(); ++i) {
            records.append(list[i]);
            applyEngineFields(context, parsed[i], records.last());
        }
        instruction.setPayloadListFrom(firstWord, encodePayloadList(records.span()).span());
    });
}

UNUSED_FUNCTION static void patchList(TextParser& parser, const PatchTarget& target, unsigned firstWord, Vector<uint32_t>&& words)
{
    parser.addPatch([target, firstWord, words = WTF::move(words)](PatchContext& context) {
        instructionAt(context, target).setPayloadListFrom(firstWord, words.span());
    });
}

static void appendWordPair(TextParser& parser, uint64_t bits)
{
    parser.code().append(static_cast<uint32_t>(bits));
    parser.code().append(static_cast<uint32_t>(bits >> 32));
}

template<typename WireRecord>
static void appendWireRecord(TextParser& parser, const WireRecord& wire)
{
    parser.code().append(std::span<const uint32_t> { std::bit_cast<std::array<uint32_t, sizeof(WireRecord) / sizeof(uint32_t)>>(wire) });
}

template<typename Record>
static void appendPayloadRecord(Vector<uint32_t>& words, const Record& record)
{
    std::array<uint32_t, PayloadWords<Record>::count> encoded;
    PayloadWords<Record>::encode(record, encoded);
    words.append(std::span<const uint32_t> { encoded });
}

using OperandWords = Vector<uint32_t, 8>;

static OperandWords parseOperands(TextParser& parser)
{
    OperandWords operands;
    if (!parser.atOperand())
        return operands;
    do {
        operands.append(parser.parseOptionalValueUseWord());
    } while (parser.accept(TokenKind::Comma));
    return operands;
}

static void appendOperand(TextParser& parser, const OperandWords& operands, size_t position)
{
    if (position >= operands.size() || operands[position] == Wire::none) {
        parser.fail();
        return;
    }
    parser.code().append(operands[position]);
}

static void appendOptionalOperand(TextParser& parser, const OperandWords& operands, size_t position)
{
    parser.code().append(position < operands.size() ? operands[position] : Wire::none);
}

static void appendVariadicOperands(TextParser& parser, const OperandWords& operands, size_t firstPosition)
{
    size_t first = std::min(firstPosition, operands.size());
    parser.code().append(static_cast<uint32_t>(operands.size() - first));
    for (uint32_t operand : operands.span().subspan(first)) {
        if (operand == Wire::none)
            parser.fail();
        parser.code().append(operand);
    }
}`.split("\n");

function defaultWireWord(isOptional: boolean): string {
  return isOptional ? "Wire::none" : "0u";
}

function patchedKind(kind: Kind): string {
  return kind.tag === "Id" && patchTranslators.has(kind.id.name) ? `, PatchedWord::${kind.id.name}` : "";
}

function parseListElements(element: Kind, target: string): string[] {
  if (isNested(element)) {
    return [
      `${engineTypeOf(element)} element;`,
      engineNestedCall(element, "element"),
      `appendPayloadRecord(${target}, element);`,
    ];
  }
  const bits = parsedBits(element);
  if (bits === null) return [`${target}.append(${parsedWord(element)});`];
  return [
    `uint64_t bits = ${bits};`,
    `${target}.append(static_cast<uint32_t>(bits));`,
    `${target}.append(static_cast<uint32_t>(bits >> 32));`,
  ];
}

function parseStreamList(entry: Entry, parameter: PayloadField, element: Kind): string[] {
  if (!isNested(element) || !isWireType(element)) {
    const words = payloadWordsOf(element);
    return scoped([
      "Vector<uint32_t> words;",
      ...guarded(parameter.name, parsedList(parseListElements(element, "words"))),
      `parser.code().append(static_cast<uint32_t>(words.size()${words === 1 ? "" : ` / ${words}`}));`,
      "parser.code().appendVector(words);",
    ]);
  }
  const engineType = engineTypeOf(element);
  const hasEngine = hasEngineFields(element);
  const elementStatements = [
    `Wire::${nameOf(element)} element;`,
    ...(hasEngine ? [`${engineType} engineElement;`] : []),
    nestedCall(element, "element", "engineElement"),
    "appendWireRecord(parser, element);",
    "++count;",
    ...(hasEngine ? ["engineElements.append(WTF::move(engineElement));"] : []),
  ];
  return scoped([
    "size_t countPosition = parser.code().size();",
    "parser.code().append(0);",
    "uint32_t count = 0;",
    ...(hasEngine ? [`Vector<${engineType}> engineElements;`] : []),
    ...guarded(parameter.name, parsedList(elementStatements)),
    "parser.code()[countPosition] = count;",
    ...(hasEngine
      ? [`patchEngineFieldsOfList<${engineType}>(parser, target, ${listFirstWord(entry)}, WTF::move(engineElements));`]
      : []),
  ]);
}

function parseStreamPayload(entry: Entry, parameter: PayloadField): string[] {
  const kind = parameter.kind;
  const accepted = `parser.acceptField(${cppLiteral(parameter.name)})`;
  if (kind.tag === "List") return parseStreamList(entry, parameter, kind.element);
  if (isNested(kind)) {
    const engineType = engineTypeOf(kind);
    if (!isWireType(kind)) {
      const parse = guarded(parameter.name, [engineNestedCall(kind, "record")]);
      return scoped([`${engineType} record;`, ...parse, "appendPayloadRecord(parser.code(), record);"]);
    }
    const hasEngine = hasEngineFields(kind);
    return scoped([
      `Wire::${nameOf(kind)} wire;`,
      ...(hasEngine ? [`${engineType} engineFields;`] : []),
      ...guarded(parameter.name, [nestedCall(kind, "wire", "engineFields")]),
      "appendWireRecord(parser, wire);",
      ...(hasEngine ? [`patchEngineFields<${engineType}>(parser, target, ${parameter.firstWord}, engineFields);`] : []),
    ]);
  }
  const bits = parsedBits(kind);
  if (bits !== null) return [`appendWordPair(parser, ${accepted} ? ${bits} : 0);`];
  return [`parser.code().append(${accepted} ? ${parsedWord(kind)} : ${defaultWireWord(parameter.isOptional)});`];
}

function parseEnginePayload(entry: Entry, parameter: PayloadField): string[] {
  const kind = parameter.kind;
  const word = parameter.firstWord;
  if ((kind.tag === "List" || isNested(kind)) && namesTypes(kind)) {
    const problem = `engine field ${parameter.name} of ${entry.name} holds a type id inside a list or a record, which a patch does not translate`;
    throw new SchemaError(parameter.location, problem);
  }
  if (kind.tag === "List") {
    return guarded(parameter.name, [
      "Vector<uint32_t> words;",
      ...parsedList(parseListElements(kind.element, "words")),
      `patchList(parser, target, ${listFirstWord(entry)}, WTF::move(words));`,
    ]);
  }
  if (isNested(kind)) {
    const patch = `patchRecord(parser, target, ${word}, record);`;
    return guarded(parameter.name, [`${engineTypeOf(kind)} record;`, engineNestedCall(kind, "record"), patch]);
  }
  const bits = parsedBits(kind);
  if (bits !== null) return guarded(parameter.name, [`patchWordPair(parser, target, ${word}, ${bits});`]);
  return guarded(parameter.name, [`patchWord(parser, target, ${word}, ${parsedWord(kind)}${patchedKind(kind)});`]);
}

function parseEntry(entry: Entry): string[] {
  const statements: string[] = [];
  let position = 0;
  for (const parameter of entry.parameters) {
    if (parameter.tag === "Payload") {
      statements.push(
        ...(parameter.isEngine ? parseEnginePayload(entry, parameter) : parseStreamPayload(entry, parameter)),
      );
    } else if (parameter.isEngine) {
      statements.push(
        ...guarded(parameter.name, [`patchOperand(parser, target, ${parameter.index}, parser.parseValueUseWord());`]),
      );
    } else if (parameter.isVariadic) {
      statements.push(`appendVariadicOperands(parser, operands, ${position});`);
    } else {
      statements.push(
        `${parameter.isOptional ? "appendOptionalOperand" : "appendOperand"}(parser, operands, ${position});`,
      );
      position += 1;
    }
  }
  if (entry.variadicOperand === null)
    statements.push(...conditional(`operands.size() > ${position}`, ["parser.fail();"]));
  return [...statements, "break;"];
}

function entryFunction(entries: readonly Entry[], enumName: string, subject: string, isTerminator: boolean): string[] {
  return [
    `void parseFields(TextParser& parser, ${enumName} ${subject})`,
    "{",
    ...indent([
      `PatchTarget target { parser.currentFunction(), parser.currentBlock(), ${isTerminator ? "{ }" : "parser.currentValue()"} };`,
      "OperandWords operands = parseOperands(parser);",
      `switch (${subject}) {`,
    ]),
    ...groupedCases(
      enumName,
      entries.map(entry => ({ label: entry.name, body: parseEntry(entry) })),
    ),
    `${indentation}}`,
    "}",
  ];
}

function entryParserSource(schema: Schema): string[] {
  const body = blocks(
    entryHelpers,
    entryFunction(schema.operations, "Opcode", "opcode", false),
    entryFunction(schema.terminators, "TerminatorKind", "kind", true),
  );
  return cppSource(['"AOTIRParserInternal.h"', "<algorithm>", "<array>", "<bit>"], inNamespace("Typed", body));
}

export function emitCppParser(context: EmitContext): OutputFile[] {
  const { schema } = context;
  return [
    { name: "AOTSchemaParser.h", lines: parserHeader(schema) },
    { name: "AOTSchemaRecordParser.cpp", lines: recordParserSource(schema) },
    { name: "AOTSchemaEntryParser.cpp", lines: entryParserSource(schema) },
  ];
}
