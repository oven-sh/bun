import { namespaceOf, underlyingTypeOf } from "./cpp-types.ts";
import {
  blocks,
  braced,
  constexprSwitch,
  cppHeader,
  cppHeaderWithoutFeatureGuard,
  cppLiteral,
  cppSource,
  inNamespace,
  indentation,
  pack,
  predicateSwitch,
  withCommas,
  type Lines,
  type SwitchOptions,
} from "./lines.ts";
import type {
  ColumnKind,
  ColumnValue,
  Entry,
  HeapMark,
  Member,
  OpaqueKind,
  ProgramList,
  Schema,
  SchemaEnum,
} from "./model.ts";
import { generatedEnumNames, heapMarks } from "./model.ts";
import { cppColumnFunctionName, programListMemberName } from "./names.ts";
import type { EmitContext, OutputFile } from "./outputs.ts";

const sharedWithBuiltinTable = [
  "OperandUse",
  "Protocol",
  "PristineAspects",
  "AbstractHeap",
  "InlineBuiltin",
  "ContentsSlot",
  "TypedResultForm",
  "WellKnownSymbol",
] as const;

const columnTypes: Readonly<Record<Exclude<ColumnKind["tag"], "Enum" | "Flags">, string>> = {
  Bool: "bool",
  UInt32: "uint32_t",
  UInt64: "uint64_t",
  Text: "ASCIILiteral",
  Name: "ASCIILiteral",
};

const limitsFile = "schema/limits.def";
const diagnosticsFile = "schema/diagnostics.def";

const heapPredicateNames: Readonly<Record<HeapMark, string>> = {
  observable: "isObservable",
  ordered: "isOrdered",
  holdsValues: "holdsValues",
  perObject: "isPerObject",
  oneValuePerLocation: "hasSingleValueLocations",
};

const enumTemplates = `template<typename E> inline constexpr unsigned numberOfEnumerators = 0;
template<typename E> inline constexpr unsigned numberOfWireEnumerators = numberOfEnumerators<E>;
template<typename E> inline constexpr bool isFlagWord = false;

template<typename E>
constexpr std::array<E, numberOfEnumerators<E>> makeAllMembers()
{
    std::array<E, numberOfEnumerators<E>> members { };
    for (unsigned i = 0; i < numberOfEnumerators<E>; ++i)
        members[i] = static_cast<E>(isFlagWord<E> ? 1u << i : i);
    return members;
}

template<typename E> inline constexpr std::array<E, numberOfEnumerators<E>> allMembersOf = makeAllMembers<E>();

template<typename E>
std::optional<E> parseEnum(StringView name)
{
    for (E member : allMembersOf<E>) {
        if (name == nameOf(member))
            return member;
    }
    return std::nullopt;
}`.split("\n");

const nameAtFunction =
  `// The names one behind the other, each with a zero behind it, and where each starts: no address, so nothing that a loader has to put right.
template<size_t count, size_t numberOfCharacters>
struct EnumeratorNames {
    uint16_t starts[count];
    char characters[numberOfCharacters];
};

template<typename E, size_t count, size_t numberOfCharacters>
static ASCIILiteral nameAt(const EnumeratorNames<count, numberOfCharacters>& names, E value)
{
    auto number = static_cast<uint32_t>(value);
    if constexpr (isFlagWord<E>) {
        RELEASE_ASSERT(hasOneBitSet(number));
        number = WTF::ctz(number);
    }
    RELEASE_ASSERT(number < count);
    return ASCIILiteral::fromLiteralUnsafe(&names.characters[names.starts[number]]);
}`.split("\n");

function enumLines(type: SchemaEnum): string[] {
  const underlying = underlyingTypeOf(type);
  const one = underlying === "uint32_t" ? "1u" : "1";
  const itemOf = (member: Member) => (type.isFlags ? `${member.name} = ${one} << ${member.number}` : member.name);
  return braced(`enum class ${type.name} : ${underlying}`, type.members.map(itemOf));
}

function columnType(kind: ColumnKind): string {
  if (kind.tag === "Enum") return kind.type.name;
  if (kind.tag === "Flags") return `OptionSet<${kind.type.name}>`;
  return columnTypes[kind.tag];
}

function qualifiedMember(kind: ColumnKind, member: Member): string {
  if (kind.tag !== "Enum" && kind.tag !== "Flags") {
    throw new Error(`a column of kind ${kind.tag} cannot hold the member ${member.name}`);
  }
  return `${kind.type.name}::${member.name}`;
}

function columnValue(kind: ColumnKind, value: ColumnValue): string {
  switch (value.tag) {
    case "Bool":
      return String(value.value);
    case "Integer":
      return kind.tag === "UInt64" ? `${value.value}ull` : `${value.value}`;
    case "Text":
      return cppLiteral(value.value);
    case "Member":
      return qualifiedMember(kind, value.member);
    case "Members":
      if (value.members.length === 0) return "{ }";
      return `{ ${value.members.map(member => qualifiedMember(kind, member)).join(", ")} }`;
  }
}

function columnLines(type: SchemaEnum): string[] {
  const lookups = type.columns.map((column, position) => {
    const cppType = columnType(column.kind);
    const table = `${column.name}By${type.name}`;
    const head = `inline constexpr ${cppType} ${table}[] =`;
    const values = type.members.map(member => columnValue(column.kind, member.values[position]));
    const array =
      column.kind.tag === "Text"
        ? [`${head} {`, ...values.map(value => `${indentation}${value},`), "};"]
        : braced(head, values);
    return [
      ...array,
      `constexpr ${cppType} ${cppColumnFunctionName(column.name)}(${type.name} value)`,
      "{",
      `${indentation}auto index = static_cast<size_t>(value);`,
      `${indentation}RELEASE_ASSERT_UNDER_CONSTEXPR_CONTEXT(index < std::size(${table}));`,
      `${indentation}return ${table}[index];`,
      "}",
    ];
  });
  return blocks(...lookups);
}

function hasDistinctWireCount(type: SchemaEnum): boolean {
  return type.wireMemberCount !== type.members.length;
}

function traitsLines(namespace: "Wire" | "Typed", enums: readonly SchemaEnum[]): string[] {
  const trait = (type: SchemaEnum, declaration: string, value: number | boolean) =>
    `template<> inline constexpr ${declaration}<${namespace}::${type.name}> = ${value};`;
  const partlyOnWire = enums.filter(hasDistinctWireCount);
  const flagWords = enums.filter(type => type.isFlags);
  return blocks(
    enums.map(type => trait(type, "unsigned numberOfEnumerators", type.members.length)),
    partlyOnWire.map(type => trait(type, "unsigned numberOfWireEnumerators", type.wireMemberCount)),
    flagWords.map(type => trait(type, "bool isFlagWord", true)),
  );
}

function nameDecls(enums: readonly SchemaEnum[]): string[] {
  return pack(
    enums.map(type => `JS_EXPORT_PRIVATE ASCIILiteral nameOf(${type.name});`),
    "",
  );
}

function generatedEnums(schema: Schema): SchemaEnum[] {
  return generatedEnumNames.map(name => {
    const type = schema.generatedEnums.get(name);
    if (type === undefined) throw new Error(`the schema model has no generated enum ${name}`);
    return type;
  });
}

function declaredEnums(schema: Schema, namespace: "Wire" | "Typed"): SchemaEnum[] {
  const positions = new Map(schema.files.map((file, index) => [file.path, index]));
  const positionOf = (type: SchemaEnum) => positions.get(type.file.path) ?? schema.files.length;
  return [...schema.enums, ...schema.flagWords]
    .filter(type => namespaceOf(type) === namespace)
    .sort((left, right) => positionOf(left) - positionOf(right));
}

// A build without the compiler still answers useImage() with an ImageVerdict.
function wireEnumsHeader(schema: Schema): string[] {
  const abi = declaredEnums(schema, "Wire");
  const includes = [
    '"JSExportMacros.h"',
    "<array>",
    "<iterator>",
    "<optional>",
    "<wtf/Assertions.h>",
    "<wtf/text/ASCIILiteral.h>",
    "<wtf/text/StringView.h>",
  ];
  return cppHeaderWithoutFeatureGuard(includes, [
    "namespace JSC { namespace AOT {",
    "",
    ...enumTemplates,
    "",
    "namespace Wire {",
    "",
    ...abi.flatMap(enumLines),
    "",
    ...nameDecls(abi),
    "",
    "} // namespace Wire",
    "",
    ...traitsLines("Wire", abi),
    "",
    "} } // namespace JSC::AOT",
  ]);
}

function wireColumnsHeader(schema: Schema, files: readonly string[], includes: Lines): string[] {
  const abi = schema.enums.filter(type => type.isAbi && files.includes(type.file.path));
  return cppHeader(includes, inNamespace("Wire", blocks(...abi.map(columnLines))));
}

function declaredEnumsHeader(schema: Schema): string[] {
  const abi = declaredEnums(schema, "Wire");
  const own = declaredEnums(schema, "Typed");
  return cppHeader(
    ['"AOTWireEnums.h"', "<wtf/OptionSet.h>"],
    [
      "namespace JSC { namespace AOT { namespace Typed {",
      "",
      ...pack(
        abi.map(type => `using Wire::${type.name};`),
        "",
      ),
      "",
      ...own.flatMap(enumLines),
      "",
      ...nameDecls(own),
      "",
      ...blocks(...own.map(columnLines)),
      "",
      "} // namespace Typed",
      "",
      ...traitsLines("Typed", own),
      "",
      "} } // namespace JSC::AOT",
    ],
  );
}

function compactSwitch(options: Omit<SwitchOptions, "qualifier">): string[] {
  const { signature, subject, enumName, cases, defaultValue } = options;
  const end =
    defaultValue === null
      ? [`${indentation}}`, `${indentation}RELEASE_ASSERT_NOT_REACHED_UNDER_CONSTEXPR_CONTEXT();`]
      : [`${indentation}default: return ${defaultValue};`, `${indentation}}`];
  return [
    `constexpr ${signature}`,
    "{",
    `${indentation}switch (${subject}) {`,
    ...cases.map(({ label, value }) => `${indentation}case ${enumName}::${label}: return ${value};`),
    ...end,
    "}",
  ];
}

function countLines(schema: Schema): string[] {
  const count = (name: string, value: number) => `inline constexpr unsigned numberOf${name} = ${value};`;
  const wireCountOf = (entries: readonly Entry[]) => entries.filter(entry => entry.isWire).length;
  return [
    count("Opcodes", schema.operations.length),
    count("WireOpcodes", wireCountOf(schema.operations)),
    count("TerminatorKinds", schema.terminators.length),
    count("WireTerminatorKinds", wireCountOf(schema.terminators)),
    count("AbstractHeaps", schema.heaps.length),
    count("WireOpaqueKinds", schema.opaqueKinds.filter(kind => !kind.isEngine).length),
    count("ProgramLists", schema.lists.length),
    count("RuntimeOperations", schema.runtimeOperations.length),
    count("InlineBuiltins", schema.inlineBuiltins.length),
  ];
}

function heapPredicates(schema: Schema): string[] {
  const predicate = (mark: HeapMark) => {
    const answers = schema.heaps.map(heap => [heap.name, heap.marks.has(mark)] as const);
    return predicateSwitch(heapPredicateNames[mark], "AbstractHeap", "heap", answers);
  };
  return blocks(...heapMarks.map(predicate));
}

function opaqueKindPredicates(schema: Schema): string[] {
  const predicate = (name: string, answerOf: (kind: OpaqueKind) => boolean) => {
    const answers = schema.opaqueKinds.map(kind => [kind.name, answerOf(kind)] as const);
    return predicateSwitch(name, "OpaqueKind", "kind", answers);
  };
  return blocks(
    predicate("isFunctionLocal", kind => kind.isFunctionLocal),
    predicate("allowsDirectCallsOnly", kind => kind.allowsDirectCallsOnly),
    predicate("isInteriorPointer", kind => kind.isInterior),
  );
}

function heapIndexCounts(schema: Schema): string[] {
  const byIndexCount = [...schema.heaps].sort((left, right) => left.indexKinds.length - right.indexKinds.length);
  return constexprSwitch({
    signature: "unsigned numberOfIndexesOf(AbstractHeap heap)",
    subject: "heap",
    enumName: "AbstractHeap",
    cases: byIndexCount.map(heap => ({ label: heap.name, value: String(heap.indexKinds.length) })),
    defaultValue: null,
  });
}

function programListLookups(schema: Schema): string[] {
  const lookup = (signature: string, valueOf: (list: ProgramList) => string | null) =>
    compactSwitch({
      signature,
      subject: "list",
      enumName: "ProgramList",
      cases: schema.lists.flatMap(list => {
        const value = valueOf(list);
        return value === null ? [] : [{ label: programListMemberName(list.name), value }];
      }),
      defaultValue: "std::nullopt",
    });
  return blocks(
    lookup("std::optional<ASCIILiteral> keywordOf(ProgramList list)", list =>
      list.keyword === null ? null : cppLiteral(list.keyword),
    ),
    lookup("std::optional<char> prefixLetterOf(ProgramList list)", list =>
      list.prefix === null ? null : `'${list.prefix}'`,
    ),
  );
}

function opaqueKindConversions(schema: Schema): string[] {
  const names = schema.opaqueKinds.map(kind => kind.name);
  return blocks(
    compactSwitch({
      signature: "OperandKind operandKindOf(OpaqueKind kind)",
      subject: "kind",
      enumName: "OpaqueKind",
      cases: names.map(name => ({ label: name, value: `OperandKind::${name}` })),
      defaultValue: null,
    }),
    compactSwitch({
      signature: "std::optional<OpaqueKind> opaqueKindOf(OperandKind kind)",
      subject: "kind",
      enumName: "OperandKind",
      cases: names.map(name => ({ label: name, value: `OpaqueKind::${name}` })),
      defaultValue: "std::nullopt",
    }),
  );
}

function entryEnumsHeader(schema: Schema): string[] {
  const generated = generatedEnums(schema);
  return cppHeader(
    ['"AOTSchemaDeclaredEnums.h"'],
    [
      "namespace JSC { namespace AOT { namespace Typed {",
      "",
      ...generated.flatMap(enumLines),
      "",
      ...countLines(schema),
      "",
      ...nameDecls(generated),
      "",
      ...blocks(
        heapPredicates(schema),
        opaqueKindPredicates(schema),
        heapIndexCounts(schema),
        programListLookups(schema),
        opaqueKindConversions(schema),
      ),
      "",
      "} // namespace Typed",
      "",
      ...traitsLines("Typed", generated),
      "",
      "} } // namespace JSC::AOT",
    ],
  );
}

function umbrellaHeader(): string[] {
  const includes = [
    '"AOTSchemaDeclaredEnums.h"',
    '"AOTSchemaEntryEnums.h"',
    '"AOTWireDiagnosticColumns.h"',
    '"AOTWireEnumColumns.h"',
    '"AOTWireEnums.h"',
    '"AOTWireLimitColumns.h"',
  ];
  return cppHeader(includes, [
    "namespace JSC { namespace AOT {",
    "",
    ...sharedWithBuiltinTable.map(name => `using Typed::${name};`),
    "",
    "} } // namespace JSC::AOT",
  ]);
}

function nameFunction(type: SchemaEnum): string[] {
  const names = type.members.map(member => member.name);
  const starts: number[] = [];
  let numberOfCharacters = 0;
  for (const name of names) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
      throw new Error(`${type.name}::${name} is no name that can stand in a literal as it is`);
    starts.push(numberOfCharacters);
    numberOfCharacters += name.length + 1;
  }
  if (numberOfCharacters > 0xffff)
    throw new Error(`the names of ${type.name} take more characters than 16 bits number`);
  // The zero behind the last name is the one that ends the literal.
  const literals = names.map((name, index) => `"${name}${index + 1 < names.length ? "\\0" : ""}"`);
  return [
    `ASCIILiteral nameOf(${type.name} value)`,
    "{",
    `${indentation}static constexpr EnumeratorNames<${names.length}, ${numberOfCharacters}> names {`,
    `${indentation}${indentation}{`,
    ...pack(withCommas(starts.map(String)), indentation.repeat(3)),
    `${indentation}${indentation}},`,
    ...pack(literals, indentation.repeat(2)),
    `${indentation}};`,
    `${indentation}return nameAt(names, value);`,
    "}",
  ];
}

function enumNamesSource(schema: Schema): string[] {
  const abi = declaredEnums(schema, "Wire");
  const own = declaredEnums(schema, "Typed");
  return cppSource(
    ['"AOTSchemaEnums.h"', "<wtf/MathExtras.h>"],
    [
      "namespace JSC { namespace AOT {",
      "",
      ...nameAtFunction,
      "",
      "namespace Wire {",
      "",
      ...blocks(...abi.map(nameFunction)),
      "",
      "} // namespace Wire",
      "",
      "namespace Typed {",
      "",
      ...blocks(...[...own, ...generatedEnums(schema)].map(nameFunction)),
      "",
      "} // namespace Typed",
      "",
      "} } // namespace JSC::AOT",
    ],
  );
}

export function emitCppEnums(context: EmitContext): OutputFile[] {
  const { schema } = context;
  const includes = ['"AOTWireEnums.h"'];
  const paths = schema.files.map(file => file.path);
  const otherFiles = paths.filter(path => path !== limitsFile && path !== diagnosticsFile);
  return [
    { name: "AOTWireEnums.h", lines: wireEnumsHeader(schema) },
    { name: "AOTWireLimitColumns.h", lines: wireColumnsHeader(schema, [limitsFile], includes) },
    { name: "AOTWireDiagnosticColumns.h", lines: wireColumnsHeader(schema, [diagnosticsFile], includes) },
    { name: "AOTWireEnumColumns.h", lines: wireColumnsHeader(schema, otherFiles, includes) },
    { name: "AOTSchemaDeclaredEnums.h", lines: declaredEnumsHeader(schema) },
    { name: "AOTSchemaEntryEnums.h", lines: entryEnumsHeader(schema) },
    { name: "AOTSchemaEnums.h", lines: umbrellaHeader() },
    { name: "AOTSchemaEnumNames.cpp", lines: enumNamesSource(schema) },
  ];
}
