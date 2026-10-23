import { namedExternalMemberOf } from "./cpp-types.ts";
import {
  blocks,
  constexprSwitch,
  cppHeader,
  cppSource,
  groupedCases,
  inNamespace,
  indent,
  indentation,
} from "./lines.ts";
import type {
  AllocationResult,
  DeclaredResult,
  Entry,
  NaturalResult,
  NaturalTable,
  PayloadField,
  Result,
  ResultRule,
  Schema,
  TypeExpression,
} from "./model.ts";
import { lowerFirst } from "./names.ts";
import type { EmitContext, OutputFile } from "./outputs.ts";

const minimumInt64 = -(1n << 63n);
const minimumInt32 = -(1n << 31n);
const maximumInt32 = (1n << 31n) - 1n;

const typeDeclarations = `struct IntegerBounds {
    int64_t minimum { 0 };
    int64_t maximum { 0 };
};

struct NaturalType {
    OptionSet<Primitives> primitives;
    std::optional<IntegerBounds> integers;
    bool isObject { false };
    bool isFunction { false };
    std::optional<OpaqueKind> opaque;
    BuiltinClassID builtinClass;
};

enum class ResultSide : uint8_t { Unproven, Proven };`.split("\n");

const lookupDeclarations = [
  "JS_EXPORT_PRIVATE NaturalType naturalTypeOf(NaturalTable, std::span<const OperandClass>);",
  "JS_EXPORT_PRIVATE uint32_t numberOfOperandsOf(NaturalTable);",
  "JS_EXPORT_PRIVATE std::optional<uint32_t> numberOfDeclaredResultsOf(Opcode);",
];

const dispatchDeclarations = [
  "template<typename Rules> typename Rules::Result applyResultRule(Rules&, const Value&, uint32_t resultIndex, ResultSide);",
  "template<typename Rules> typename Rules::Result applyEdgeResultRule(Rules&, const Terminator&, uint32_t targetIndex, uint32_t resultIndex, ResultSide);",
];

function resultRulesHeader(): string[] {
  const declarations = blocks(typeDeclarations, lookupDeclarations, dispatchDeclarations);
  const body = [...inNamespace("Typed", declarations), "", '#include "AOTSchemaResultRulesInlines.h"'];
  return cppHeader(['"AOTBlock.h"', "<optional>", "<span>"], body);
}

function integerLiteral(value: bigint): string {
  if (value === minimumInt64) return "INT64_MIN";
  return value >= minimumInt32 && value <= maximumInt32 ? value.toString() : `${value}ll`;
}

function naturalType(schema: Schema, type: TypeExpression): string {
  const { primitives, integers, opaque, builtinClass } = type;
  const parts = [
    primitives.length === 0 ? "{ }" : `{ ${primitives.map(primitive => `Primitives::${primitive}`).join(", ")} }`,
    integers === null
      ? "std::nullopt"
      : `IntegerBounds { ${integerLiteral(integers.minimum)}, ${integerLiteral(integers.maximum)} }`,
    String(type.isObject),
    String(type.isFunction),
    opaque === null ? "std::nullopt" : `OpaqueKind::${opaque.name}`,
    builtinClass === null ? "{ }" : namedExternalMemberOf(schema, "BuiltinClass", builtinClass),
  ];
  return `NaturalType { ${parts.join(", ")} }`;
}

function payloadOf(subject: string, field: PayloadField): string {
  return `${subject}.${field.name}()`;
}

function naturalCall(schema: Schema, natural: NaturalResult, subject: string): string {
  switch (natural.tag) {
    case "SameAs":
      return `rules.sameAs(${subject}, ${natural.operand.index})`;
    case "Table":
      return `rules.natural(${subject}, NaturalTable::${natural.table.name})`;
    case "Type":
      return `rules.natural(${subject}, ${naturalType(schema, natural.type)})`;
  }
}

function allocationCall(schema: Schema, allocation: AllocationResult, subject: string): string {
  switch (allocation.tag) {
    case "Layout":
      return `rules.allocation(${subject}, ${payloadOf(subject, allocation.layout)})`;
    case "Class": {
      const contents = allocation.contents === null ? "" : `, ${payloadOf(subject, allocation.contents)}`;
      return `rules.allocation(${subject}, ${namedExternalMemberOf(schema, "BuiltinClass", allocation.builtinClass)}${contents})`;
    }
    case "BuiltinLayout":
      return `rules.allocation(${subject}, ${namedExternalMemberOf(schema, "BuiltinLayout", allocation.builtinLayout)})`;
  }
}

function declaredCall(declared: DeclaredResult, subject: string): string {
  switch (declared.tag) {
    case "BlockParameter":
      return `rules.declaredParameter(${subject})`;
    case "Variable":
    case "Layout":
    case "Module":
    case "Type":
      return `rules.declared(${subject}, ${payloadOf(subject, declared.field)})`;
    case "Function":
    case "Overload":
      return `rules.declared(${subject}, ${payloadOf(subject, declared.field)}, resultIndex)`;
    case "Field":
      return `rules.declared(${subject}, ${payloadOf(subject, declared.layout)}, ${payloadOf(subject, declared.field)})`;
    case "Key":
      return `rules.declared(${subject}, ${payloadOf(subject, declared.key)})`;
    case "Contents": {
      const slot = declared.slot === null ? "std::nullopt" : `ContentsSlot::${declared.slot.name}`;
      return `rules.declaredContents(${subject}, ${declared.operand.index}, ${slot})`;
    }
    case "ResultAt":
      return `rules.declaredResult(${subject}, ${declared.producer.index}, ${payloadOf(subject, declared.index)})`;
  }
}

function ruleCall(schema: Schema, rule: ResultRule, subject: string): string {
  switch (rule.rule) {
    case "None":
    case "Unknown":
    case "Constant":
      return `rules.${lowerFirst(rule.rule)}(${subject})`;
    case "Cast": {
      const type = rule.type === null ? "" : `, ${payloadOf(subject, rule.type)}`;
      return `rules.cast(${subject}, ${rule.returned.index}${type})`;
    }
    case "Natural":
      return naturalCall(schema, rule.natural, subject);
    case "Allocation":
      return allocationCall(schema, rule.allocation, subject);
    case "Declared":
      return declaredCall(rule.declared, subject);
    case "Results":
      throw new Error("results(..) stands for one rule per result, not for one call");
  }
}

function resultExpression(schema: Schema, result: Result, subject: string): string {
  const unproven = ruleCall(schema, result.unproven, subject);
  return result.proven === null ? unproven : `isProven ? ${ruleCall(schema, result.proven, subject)} : ${unproven}`;
}

function indexedResults(schema: Schema, results: readonly Result[], isOpen: boolean, subject: string): string[] {
  if (isOpen && results.length === 0) return [`return rules.resultOperand(${subject}, resultIndex);`];
  const returns = results.map(result => `return ${resultExpression(schema, result, subject)};`);
  const listed = isOpen ? returns.slice(0, -1) : returns;
  const otherwise = isOpen ? returns[returns.length - 1] : "RELEASE_ASSERT_NOT_REACHED();";
  if (listed.length === 0) return [otherwise];
  return [
    "switch (resultIndex) {",
    ...listed.flatMap((statement, index) => [`case ${index}:`, indentation + statement]),
    "default:",
    indentation + otherwise,
    "}",
  ];
}

function valueBody(schema: Schema, entry: Entry): string[] {
  const rule = entry.result.unproven;
  if (rule.rule === "Results") return indexedResults(schema, rule.results, rule.isOpen, "value");
  return [`return ${resultExpression(schema, entry.result, "value")};`];
}

function terminatorBody(schema: Schema, entry: Entry): string[] {
  const lines = entry.targets
    .filter(target => target.results.length > 0)
    .flatMap(target => [
      `if (targetIndex == ${target.index}) {`,
      ...indent(indexedResults(schema, target.results, false, "terminator")),
      "}",
    ]);
  return [...lines, "RELEASE_ASSERT_NOT_REACHED();"];
}

function resultRulesInlines(schema: Schema): string[] {
  const valueCases = schema.operations.map(entry => ({ label: entry.name, body: valueBody(schema, entry) }));
  const terminatorCases = schema.terminators.map(entry => ({ label: entry.name, body: terminatorBody(schema, entry) }));
  const definitions = [
    "template<typename Rules>",
    "typename Rules::Result applyResultRule(Rules& rules, const Value& value, uint32_t resultIndex, ResultSide side)",
    "{",
    "    UNUSED_PARAM(resultIndex);",
    "    bool isProven = side == ResultSide::Proven;",
    "    switch (value.opcode) {",
    ...groupedCases("Opcode", valueCases),
    "    }",
    "    RELEASE_ASSERT_NOT_REACHED();",
    "}",
    "",
    "template<typename Rules>",
    "typename Rules::Result applyEdgeResultRule(Rules& rules, const Terminator& terminator, uint32_t targetIndex, uint32_t resultIndex, ResultSide side)",
    "{",
    "    bool isProven = side == ResultSide::Proven;",
    "    UNUSED_VARIABLE(isProven);",
    "    switch (terminator.kind) {",
    ...groupedCases("TerminatorKind", terminatorCases),
    "    }",
    "    RELEASE_ASSERT_NOT_REACHED();",
    "}",
  ];
  return cppHeader(['"AOTBuiltinIDTypes.h"'], inNamespace("Typed", definitions));
}

function tableBody(schema: Schema, table: NaturalTable): string[] {
  const rows = table.rows.flatMap(row => [
    `if (matches({ ${row.classes.map(operandClass => `OperandClass::${operandClass}`).join(", ")} }))`,
    `${indentation}return ${naturalType(schema, row.type)};`,
  ]);
  return [...rows, `return ${naturalType(schema, table.otherwise)};`];
}

function resultRulesSource(schema: Schema): string[] {
  const tables = schema.naturalTables;
  const naturalTypeOf = [
    "NaturalType naturalTypeOf(NaturalTable table, std::span<const OperandClass> classes)",
    "{",
    "    auto matches = [&](std::initializer_list<OperandClass> row) {",
    "        RELEASE_ASSERT(row.size() == classes.size());",
    "        size_t position = 0;",
    "        for (OperandClass wanted : row) {",
    "            if (wanted != OperandClass::Any && wanted != classes[position])",
    "                return false;",
    "            ++position;",
    "        }",
    "        return true;",
    "    };",
    "    switch (table) {",
    ...groupedCases(
      "NaturalTable",
      tables.map(table => ({ label: table.name, body: tableBody(schema, table) })),
    ),
    "    }",
    "    RELEASE_ASSERT_NOT_REACHED();",
    "}",
  ];
  const numberOfOperandsOf = constexprSwitch({
    signature: "uint32_t numberOfOperandsOf(NaturalTable table)",
    subject: "table",
    enumName: "NaturalTable",
    cases: tables.map(table => ({ label: table.name, value: String(table.arity) })),
    defaultValue: null,
    qualifier: "",
  });
  const numberOfDeclaredResultsOf = constexprSwitch({
    signature: "std::optional<uint32_t> numberOfDeclaredResultsOf(Opcode opcode)",
    subject: "opcode",
    enumName: "Opcode",
    cases: schema.operations.map(entry => {
      const rule = entry.result.unproven;
      const count = rule.rule === "Results" && !rule.isOpen ? String(rule.results.length) : "std::nullopt";
      return { label: entry.name, value: count };
    }),
    defaultValue: "std::nullopt",
    qualifier: "",
  });
  const definitions = blocks(naturalTypeOf, numberOfOperandsOf, numberOfDeclaredResultsOf);
  return cppSource(['"AOTSchemaResultRules.h"', "<initializer_list>"], inNamespace("Typed", definitions));
}

export function emitCppResultRules(context: EmitContext): OutputFile[] {
  return [
    { name: "AOTSchemaResultRules.h", lines: resultRulesHeader() },
    { name: "AOTSchemaResultRulesInlines.h", lines: resultRulesInlines(context.schema) },
    { name: "AOTSchemaResultRules.cpp", lines: resultRulesSource(context.schema) },
  ];
}
