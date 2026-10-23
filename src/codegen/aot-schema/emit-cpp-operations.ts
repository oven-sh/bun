import { defaultWordsOf, listFirstWord, namedExternalMemberOf } from "./cpp-types.ts";
import {
  blocks,
  braced,
  constexprSwitch,
  cppHeader,
  cppLiteral,
  cppSource,
  inNamespace,
  indentation,
  macroLines,
} from "./lines.ts";
import type {
  Entry,
  EntryColumn,
  EntryColumnValue,
  Flag,
  Member,
  Operand,
  PayloadField,
  ResultRule,
  Schema,
  Target,
} from "./model.ts";
import { entriesOf, wireFlagsOf } from "./model.ts";
import { cppColumnFunctionName, cppFamilyMacroName } from "./names.ts";
import type { EmitContext, OutputFile } from "./outputs.ts";

type EntryEnumName = "Opcode" | "TerminatorKind";

type EntryEmitter = (entries: readonly Entry[], enumName: EntryEnumName, parameter: string) => string[];

type EntryContents = readonly (readonly [Entry, readonly string[]])[];

interface SharedArrays {
  readonly declarations: readonly string[];
  readonly byEntry: ReadonlyMap<Entry, string>;
}

const wirePredicates =
  `constexpr bool isWire(Opcode opcode) { return static_cast<unsigned>(opcode) < numberOfWireOpcodes; }
constexpr bool isWire(TerminatorKind kind) { return static_cast<unsigned>(kind) < numberOfWireTerminatorKinds; }`.split(
    "\n",
  );

const entryInfoDeclarations = `JS_EXPORT_PRIVATE std::span<const uint32_t> defaultPayloadOf(Opcode);
JS_EXPORT_PRIVATE std::span<const uint32_t> defaultPayloadOf(TerminatorKind);

struct OperandInfo {
    ASCIILiteral name;
    OperandKind kind { OperandKind::Any };
    bool isOptional { false };
    bool isVariadic { false };
    bool isEngineOnly { false };
    OperandUses uses;
    Protocols protocols;
    RetainedIn retainedIn { RetainedIn::UnknownMemory };
    std::optional<uint8_t> retainingOperand;
    std::optional<uint8_t> assignedFromOperand;
    std::span<const BuiltinName> namedMembers;
};

JS_EXPORT_PRIVATE const OperandInfo& operandInfoOf(Opcode, uint32_t operandIndex);
JS_EXPORT_PRIVATE const OperandInfo& operandInfoOf(TerminatorKind, uint32_t operandIndex);

inline OperandKind operandKindOf(Opcode opcode, uint32_t operandIndex) { return operandInfoOf(opcode, operandIndex).kind; }
inline OperandKind operandKindOf(TerminatorKind kind, uint32_t operandIndex) { return operandInfoOf(kind, operandIndex).kind; }
inline OperandUses operandUsesOf(Opcode opcode, uint32_t operandIndex) { return operandInfoOf(opcode, operandIndex).uses; }
inline OperandUses operandUsesOf(TerminatorKind kind, uint32_t operandIndex) { return operandInfoOf(kind, operandIndex).uses; }
inline Protocols protocolsOf(Opcode opcode, uint32_t operandIndex) { return operandInfoOf(opcode, operandIndex).protocols; }
inline Protocols protocolsOf(TerminatorKind kind, uint32_t operandIndex) { return operandInfoOf(kind, operandIndex).protocols; }
inline std::span<const BuiltinName> namedMembersOf(Opcode opcode, uint32_t operandIndex) { return operandInfoOf(opcode, operandIndex).namedMembers; }
inline std::span<const BuiltinName> namedMembersOf(TerminatorKind kind, uint32_t operandIndex) { return operandInfoOf(kind, operandIndex).namedMembers; }
inline RetainedIn retainedInOf(Opcode opcode, uint32_t operandIndex) { return operandInfoOf(opcode, operandIndex).retainedIn; }
inline RetainedIn retainedInOf(TerminatorKind kind, uint32_t operandIndex) { return operandInfoOf(kind, operandIndex).retainedIn; }
inline std::optional<uint8_t> retainingOperandOf(Opcode opcode, uint32_t operandIndex) { return operandInfoOf(opcode, operandIndex).retainingOperand; }
inline std::optional<uint8_t> retainingOperandOf(TerminatorKind kind, uint32_t operandIndex) { return operandInfoOf(kind, operandIndex).retainingOperand; }

struct PayloadFieldInfo {
    ASCIILiteral name;
    PayloadKind kind { PayloadKind::UInt32 };
    PayloadKind elementKind { PayloadKind::UInt32 };
    uint8_t firstWord { 0 };
    uint8_t numberOfWords { 0 };
    bool isOptional { false };
    bool isEngineOnly { false };
    IRForm firstForm { IRForm::AsRead };
};

JS_EXPORT_PRIVATE std::span<const PayloadFieldInfo> payloadFieldsOf(Opcode);
JS_EXPORT_PRIVATE std::span<const PayloadFieldInfo> payloadFieldsOf(TerminatorKind);
JS_EXPORT_PRIVATE std::span<const ASCIILiteral> flagNamesOf(Opcode);
JS_EXPORT_PRIVATE std::span<const ASCIILiteral> flagNamesOf(TerminatorKind);

struct TargetInfo {
    ASCIILiteral name;
    bool isVariadic { false };
    bool takesProofs { false };
    uint8_t numberOfResults { 0 };
};

JS_EXPORT_PRIVATE std::span<const TargetInfo> targetInfosOf(TerminatorKind);`.split("\n");

const declaredPosition = `constexpr unsigned declaredPosition(std::optional<unsigned> position)
{
    RELEASE_ASSERT_UNDER_CONSTEXPR_CONTEXT(position);
    return *position;
}`.split("\n");

const positionIncludes = `#include "AOTSchemaFlagMasks.h"
#include "AOTSchemaOperandPositions.h"
#include "AOTSchemaOperationColumns.h"
#include "AOTSchemaPayloadPositions.h"
#include "AOTSchemaRuntimeColumns.h"
#include "AOTSchemaVariadicOperandPositions.h"`.split("\n");

const replacedEntryDeclarations = `JS_EXPORT_PRIVATE std::span<const Opcode> replacedOperationsOf(Opcode);
JS_EXPORT_PRIVATE std::span<const Opcode> replacedOperationsOf(TerminatorKind);
JS_EXPORT_PRIVATE std::span<const TerminatorKind> replacedTerminatorsOf(Opcode);
JS_EXPORT_PRIVATE std::span<const TerminatorKind> replacedTerminatorsOf(TerminatorKind);`.split("\n");

function forOperations(schema: Schema, emit: EntryEmitter): string[] {
  return emit(schema.operations, "Opcode", "opcode");
}

function forTerminators(schema: Schema, emit: EntryEmitter): string[] {
  return emit(schema.terminators, "TerminatorKind", "kind");
}

function both(schema: Schema, emit: EntryEmitter): string[] {
  return blocks(forOperations(schema, emit), forTerminators(schema, emit));
}

function lookup(
  type: string,
  name: string,
  valueOf: (entry: Entry) => string,
  defaultValue: string | null,
): EntryEmitter {
  return (entries, enumName, parameter) =>
    constexprSwitch({
      signature: `${type} ${name}(${enumName} ${parameter})`,
      subject: parameter,
      enumName,
      cases: entries.map(entry => ({ label: entry.name, value: valueOf(entry) })),
      defaultValue,
    });
}

function operandsOf(entry: Entry): Operand[] {
  return entry.variadicOperand === null ? [...entry.namedOperands] : [...entry.namedOperands, entry.variadicOperand];
}

function initializer(parts: readonly (string | number)[]): string {
  return `{ ${parts.join(", ")} }`;
}

function entryMacrosHeader(schema: Schema): string[] {
  const namesOf = (entries: readonly Entry[]) => entries.map(entry => entry.name);
  const familyMacros = (prefix: "OPCODE" | "TERMINATOR_KIND", entries: readonly Entry[]) =>
    schema.families
      .map(family => ({ family, members: namesOf(entries.filter(entry => entry.family === family)) }))
      .filter(({ members }) => members.length > 0)
      .map(({ family, members }) => macroLines(cppFamilyMacroName(prefix, family), members));
  return cppHeader(
    [],
    blocks(
      macroLines("FOR_EACH_AOT_OPCODE", namesOf(schema.operations)),
      ...familyMacros("OPCODE", schema.operations),
      macroLines("FOR_EACH_AOT_TERMINATOR_KIND", namesOf(schema.terminators)),
      ...familyMacros("TERMINATOR_KIND", schema.terminators),
      macroLines("FOR_EACH_AOT_OPERATION_FAMILY", schema.families),
    ),
  );
}

function operandIndexesHeader(schema: Schema): string[] {
  const namespaces = entriesOf(schema).flatMap(entry => {
    const constants = operandsOf(entry).map(operand => `inline constexpr uint32_t ${operand.name} = ${operand.index};`);
    return constants.length === 0 ? [] : [`namespace ${entry.name} { ${constants.join(" ")} }`];
  });
  return cppHeader(
    ["<cstdint>"],
    [
      "namespace JSC { namespace AOT { namespace Typed { namespace OperandIndex {",
      "",
      ...namespaces,
      "",
      "} } } } // namespace JSC::AOT::Typed::OperandIndex",
    ],
  );
}

function operationsHeader(schema: Schema): string[] {
  const family = (entry: Entry) => `OperationFamily::${entry.family}`;
  const forms = (entry: Entry) => `IRFormSet::between(IRForm::${entry.firstForm}, IRForm::${entry.lastForm})`;
  const rule = (result: ResultRule) => `ResultRule::${result.rule}`;
  const provenRule = (entry: Entry) => (entry.result.proven === null ? "std::nullopt" : rule(entry.result.proven));
  const effectRule = (entry: Entry) => `EffectRule::${entry.effectRule}`;
  const namedOperandCount = (entry: Entry) => String(entry.namedOperands.length);
  const flagMask = (flags: readonly Flag[]) => `0x${((1 << flags.length) - 1).toString(16)}`;
  const fixedTargets = (entry: Entry) =>
    entry.targets.some(target => target.isVariadic) ? "std::nullopt" : String(entry.targets.length);
  const declarations = blocks(
    wirePredicates,
    both(schema, lookup("OperationFamily", "familyOf", family, "most common")),
    both(schema, lookup("IRFormSet", "formsOf", forms, "most common")),
    forOperations(
      schema,
      lookup("ResultRule", "resultRuleOf", entry => rule(entry.result.unproven), "most common"),
    ),
    forOperations(schema, lookup("std::optional<ResultRule>", "provenResultRuleOf", provenRule, "std::nullopt")),
    both(schema, lookup("EffectRule", "effectRuleOf", effectRule, "EffectRule::Declared")),
    both(schema, lookup("uint32_t", "numberOfNamedOperandsOf", namedOperandCount, "most common")),
    both(
      schema,
      lookup("bool", "hasVariadicOperand", entry => truth(entry.variadicOperand !== null), "false"),
    ),
    both(
      schema,
      lookup("uint16_t", "declaredFlagsOf", entry => flagMask(entry.flags), "0x0"),
    ),
    both(
      schema,
      lookup("uint16_t", "wireFlagsOf", entry => flagMask(wireFlagsOf(entry)), "0x0"),
    ),
    entryInfoDeclarations,
    forTerminators(schema, lookup("std::optional<uint32_t>", "numberOfFixedTargetsOf", fixedTargets, null)),
    declaredPosition,
  );
  const includes = [
    '"AOTBuiltinIDTypes.h"',
    '"AOTSchemaEntryMacros.h"',
    '"AOTSchemaEnums.h"',
    '"AOTSchemaOperandIndexes.h"',
    "<optional>",
    "<span>",
  ];
  return cppHeader(includes, [...inNamespace("Typed", declarations), "", ...positionIncludes]);
}

function columnFunctions(schema: Schema, column: EntryColumn): string[] {
  const kind = column.kind;
  const functions = (type: string, unset: string, textOf: (value: EntryColumnValue) => string | null) => {
    const valueOf = (entry: Entry) => {
      const value = entry.columns.get(column.name);
      return (value === undefined ? null : textOf(value)) ?? unset;
    };
    return both(schema, lookup(type, cppColumnFunctionName(column.name), valueOf, unset));
  };
  switch (kind.tag) {
    case "Bool":
      return functions("bool", "false", value => (value.tag === "Bool" ? truth(value.value) : null));
    case "UInt32":
      return functions("uint32_t", "0", value => (value.tag === "UInt32" ? String(value.value) : null));
    case "Operand":
      return functions("std::optional<uint8_t>", "std::nullopt", value =>
        value.tag === "Operand" ? String(value.operand.index) : null,
      );
    case "RuntimeOperation":
      return functions("std::optional<RuntimeOperation>", "std::nullopt", value =>
        value.tag === "RuntimeOperation" ? `RuntimeOperation::${value.operation.name}` : null,
      );
    case "Enum": {
      const type = kind.type.name;
      return functions(type, `${type}::${kind.type.members[0].name}`, value =>
        value.tag === "Member" ? `${type}::${value.member.name}` : null,
      );
    }
    case "EnumSet": {
      const element = kind.type.name;
      return functions(`EnumeratorBitSet<${element}, numberOfEnumerators<${element}>>`, "{ }", value =>
        value.tag === "Members" ? setText(element, value.members) : null,
      );
    }
    case "Flags": {
      const flagWord = kind.type.name;
      const type = `OptionSet<${flagWord}>`;
      return functions(type, `${type} ${setText(flagWord, [])}`, value =>
        value.tag === "Members" ? `${type} ${setText(flagWord, value.members)}` : null,
      );
    }
    case "Operations":
      return replacedEntryDeclarations;
    case "Parameters":
      return [];
  }
}

function namesRuntimeOperation(column: EntryColumn): boolean {
  return column.kind.tag === "RuntimeOperation";
}

function columnsHeader(schema: Schema, columns: readonly EntryColumn[]): string[] {
  const functions = columns.map(column => columnFunctions(schema, column));
  return cppHeader([], inNamespace("Typed", blocks(...functions)));
}

function sharedArrays(elementType: string, prefix: string, contents: EntryContents): SharedArrays {
  const names = new Map<string, string>();
  const declarations: string[] = [];
  const byEntry = new Map<Entry, string>();
  for (const [entry, elements] of contents) {
    if (elements.length === 0) continue;
    const key = elements.join("\n");
    let name = names.get(key);
    if (name === undefined) {
      name = `${prefix}${names.size}`;
      names.set(key, name);
      const head = `static constexpr ${elementType} ${name}[] =`;
      if (elements[0].startsWith("{")) {
        declarations.push(`${head} {`, ...elements.map(element => `${indentation}${element},`), "};");
      } else {
        declarations.push(...braced(head, elements));
      }
    }
    byEntry.set(entry, name);
  }
  return { declarations, byEntry };
}

function spanFunction(
  signature: string,
  subject: string,
  enumName: EntryEnumName,
  entries: readonly Entry[],
  byEntry: ReadonlyMap<Entry, string>,
): string[] {
  return constexprSwitch({
    signature,
    subject,
    enumName,
    cases: entries.map(entry => ({ label: entry.name, value: byEntry.get(entry) ?? "{ }" })),
    defaultValue: "{ }",
    qualifier: "",
  });
}

function operandUses(operand: Operand): string {
  const { uses, protocols, retainedIn, retainingOperand, assignedFromOperand } = operand.uses;
  return [
    setText("OperandUse", uses),
    setText("Protocol", protocols),
    `RetainedIn::${retainedIn}`,
    retainingOperand ?? "std::nullopt",
    assignedFromOperand ?? "std::nullopt",
  ].join(", ");
}

function setText(enumName: string, members: readonly Member[]): string {
  return members.length === 0 ? "{ }" : initializer(members.map(member => `${enumName}::${member.name}`));
}

function truth(value: boolean): string {
  return value ? "true" : "false";
}

function operandInfo(operand: Operand, namedMembers: string): string {
  return initializer([
    cppLiteral(operand.name),
    `OperandKind::${operand.kind.name}`,
    truth(operand.isOptional),
    truth(operand.isVariadic),
    truth(operand.isEngine),
    operandUses(operand),
    namedMembers,
  ]);
}

function payloadFieldInfo(entry: Entry, field: PayloadField): string {
  const kind = field.payloadKind.name;
  const elementKind = field.elementPayloadKind?.name ?? kind;
  return initializer([
    cppLiteral(field.name),
    `PayloadKind::${kind}`,
    `PayloadKind::${elementKind}`,
    field.firstWord ?? listFirstWord(entry),
    field.kind.tag === "List" ? 0 : field.payloadWords,
    truth(field.isOptional),
    truth(field.isEngine),
    `IRForm::${field.firstForm}`,
  ]);
}

function defaultPayload(entry: Entry): string[] {
  const scalarFields = entry.payload.filter(field => field.kind.tag !== "List");
  return scalarFields.flatMap(field => defaultWordsOf(field.kind, field.isOptional));
}

function targetInfo(target: Target): string {
  return initializer([
    cppLiteral(target.name),
    truth(target.isVariadic),
    truth(target.takesProofs),
    target.results.length,
  ]);
}

function replacedEntries(entry: Entry, enumName: EntryEnumName): string[] {
  return [...entry.columns.values()]
    .flatMap(value => (value.tag === "Operations" ? value.entries : []))
    .filter(replaced => replaced.isTerminator === (enumName === "TerminatorKind"))
    .map(replaced => `${enumName}::${replaced.name}`);
}

function operandInfoFunction(enumName: EntryEnumName, parameter: string): string[] {
  return [
    `const OperandInfo& operandInfoOf(${enumName} ${parameter}, uint32_t operandIndex)`,
    "{",
    `    std::span<const OperandInfo> infos = operandInfosOf(${parameter});`,
    "    RELEASE_ASSERT(operandIndex < infos.size() || (!infos.empty() && infos.back().isVariadic));",
    "    return infos[std::min<size_t>(operandIndex, infos.size() - 1)];",
    "}",
  ];
}

function operationsSource(schema: Schema): string[] {
  // The table of built-ins says which of its names the engine means by BuiltinNames::x: in a list, at the position of x. One name is a stretch of that list.
  const namedMembersOf = (operand: Operand) => {
    const [member, ...others] = operand.uses.namedMembers;
    if (member === undefined) return "{ }";
    if (others.length > 0) {
      throw new Error(
        `${operand.name}: an operand names one member at the most: ${operand.uses.namedMembers.join(", ")}`,
      );
    }
    const constant = namedExternalMemberOf(schema, "BuiltinName", member);
    return `std::span<const BuiltinName>(&builtinTableNamedNames[${constant}.position()], 1)`;
  };
  const contents = (entries: readonly Entry[], elementsOf: (entry: Entry) => string[]): EntryContents =>
    entries.map(entry => [entry, elementsOf(entry)]);
  const arrays = (elementType: string, prefix: string, elementsOf: (entry: Entry) => string[]) =>
    sharedArrays(elementType, prefix, contents(entriesOf(schema), elementsOf));
  const operands = arrays("OperandInfo", "operandInfos", entry =>
    operandsOf(entry).map(operand => operandInfo(operand, namedMembersOf(operand))),
  );
  const defaults = arrays("uint32_t", "defaultPayload", defaultPayload);
  const payload = arrays("PayloadFieldInfo", "payloadFields", entry =>
    entry.payload.map(field => payloadFieldInfo(entry, field)),
  );
  const flags = arrays("ASCIILiteral", "flagNames", entry => entry.flags.map(flag => cppLiteral(flag.name)));
  const targetContents = contents(schema.terminators, entry => entry.targets.map(targetInfo));
  const targets = sharedArrays("TargetInfo", "targetInfos", targetContents);
  const replacedOperations = arrays("Opcode", "replacedOperations", entry => replacedEntries(entry, "Opcode"));
  const replacedTerminators = arrays("TerminatorKind", "replacedTerminators", entry =>
    replacedEntries(entry, "TerminatorKind"),
  );
  const spans =
    (type: string, name: string, shared: SharedArrays): EntryEmitter =>
    (entries, enumName, parameter) =>
      spanFunction(`${type} ${name}(${enumName} ${parameter})`, parameter, enumName, entries, shared.byEntry);
  const pair = (elementType: string, name: string, shared: SharedArrays) =>
    both(schema, spans(`std::span<const ${elementType}>`, name, shared));
  const definitions = blocks(
    operands.declarations,
    both(schema, spans("static std::span<const OperandInfo>", "operandInfosOf", operands)),
    operandInfoFunction("Opcode", "opcode"),
    operandInfoFunction("TerminatorKind", "kind"),
    defaults.declarations,
    pair("uint32_t", "defaultPayloadOf", defaults),
    payload.declarations,
    pair("PayloadFieldInfo", "payloadFieldsOf", payload),
    flags.declarations,
    pair("ASCIILiteral", "flagNamesOf", flags),
    targets.declarations,
    forTerminators(schema, spans("std::span<const TargetInfo>", "targetInfosOf", targets)),
    replacedOperations.declarations,
    pair("Opcode", "replacedOperationsOf", replacedOperations),
    replacedTerminators.declarations,
    pair("TerminatorKind", "replacedTerminatorsOf", replacedTerminators),
  );
  return cppSource(['"AOTOpcode.h"', '"AOTBuiltinIDTypes.h"', "<algorithm>"], inNamespace("Typed", definitions));
}

export function emitCppOperations(context: EmitContext): OutputFile[] {
  const schema = context.schema;
  return [
    { name: "AOTSchemaEntryMacros.h", lines: entryMacrosHeader(schema) },
    { name: "AOTSchemaOperandIndexes.h", lines: operandIndexesHeader(schema) },
    { name: "AOTSchemaOperations.h", lines: operationsHeader(schema) },
    {
      name: "AOTSchemaOperationColumns.h",
      lines: columnsHeader(
        schema,
        schema.entryColumns.filter(column => !namesRuntimeOperation(column)),
      ),
    },
    {
      name: "AOTSchemaRuntimeColumns.h",
      lines: columnsHeader(schema, schema.entryColumns.filter(namesRuntimeOperation)),
    },
    { name: "AOTSchemaOperations.cpp", lines: operationsSource(schema) },
  ];
}
