import {
  engineFieldsOf,
  engineRecordNameOf,
  engineTypeOf,
  engineTypesInDependencyOrder,
  isBorrowedSpan,
  isEmbeddedInEngineRecords,
  twoWordScalars,
} from "./cpp-types.ts";
import {
  blocks,
  cppHeader,
  cppLiteral,
  cppSource,
  groupedCases,
  indent,
  indentation,
  inNamespace,
  pack,
} from "./lines.ts";
import type { Entry, Field, Kind, Schema, SchemaType, Variant } from "./model.ts";
import { entriesOf, fieldsOf, isId, isNested, nameOf } from "./model.ts";
import type { EmitContext, OutputFile } from "./outputs.ts";
import { SchemaError } from "./source.ts";

type ListKind = Extract<Kind, { tag: "Span" | "List" }>;

interface PrintedValue {
  readonly name: string;
  readonly kind: Kind;
  readonly isOptional: boolean;
  readonly expression: string;
  readonly inAbi: boolean;
  readonly isPayload: boolean;
  readonly guard: string | null;
}

function isList(kind: Kind): kind is ListKind {
  return kind.tag === "Span" || kind.tag === "List";
}

export function printedTypes(schema: Schema): SchemaType[] {
  const own = engineTypesInDependencyOrder(schema).filter(type => !(type.tag === "Record" && type.record.isCustomText));
  const abi = schema.types.filter(
    type => type.tag === "Record" && type.record.form === "abi" && isEmbeddedInEngineRecords(schema, type),
  );
  return [...abi, ...own];
}

function printerHeader(schema: Schema): string[] {
  const records: string[] = [];
  const variants: string[] = [];
  for (const type of printedTypes(schema)) {
    if (type.tag === "Record") records.push(`void printFields(IRPrinter&, const ${engineRecordNameOf(type.record)}&);`);
    else variants.push(`void printVariant(IRPrinter&, const ${type.variant.name}&);`);
  }
  const entries = ["void printFields(IRPrinter&, const Value&);", "void printFields(IRPrinter&, const Terminator&);"];
  return cppHeader([], inNamespace("Typed", blocks(records, variants, entries)));
}

export function printedFields(schema: Schema, type: SchemaType): readonly Field[] {
  return type.tag === "Record" ? engineFieldsOf(type.record) : fieldsOf(type);
}

function zeroTestedFields(schema: Schema, type: SchemaType): readonly Field[] {
  return type.tag === "Variant" ? type.variant.cases[0].fields : printedFields(schema, type);
}

function canBeZero(schema: Schema, type: SchemaType): boolean {
  return zeroTestedFields(schema, type).every(field => canBeZeroField(schema, field));
}

function canBeZeroField(schema: Schema, field: Field): boolean {
  if (isId(field.kind)) return field.isOptional;
  if (isNested(field.kind)) return canBeZero(schema, field.kind);
  return true;
}

export function isAbiEnum(schema: Schema, kind: Kind): boolean {
  return (kind.tag === "Enum" || kind.tag === "Flags") && kind.type.isAbi;
}

function typedValue(schema: Schema, kind: Kind, isOptional: boolean, expression: string, inAbi: boolean): string {
  const isUInt8 = kind.tag === "Scalar" && kind.scalar === "UInt8";
  if (inAbi) {
    if (isId(kind)) return `${engineTypeOf(kind)}(${expression})`;
    if (kind.tag === "Enum")
      return isAbiEnum(schema, kind) && !isOptional ? expression : `static_cast<${kind.type.name}>(${expression})`;
    if (kind.tag === "Flags")
      return `OptionSet<${kind.type.name}>::fromRaw(static_cast<OptionSet<${kind.type.name}>::StorageType>(${expression}))`;
    if (kind.tag === "Scalar" && kind.scalar === "Bool") return `!!${expression}`;
    return isUInt8 ? `static_cast<uint32_t>(${expression})` : expression;
  }
  if (isId(kind)) return expression;
  if (kind.tag === "External") return `static_cast<uint32_t>(${isOptional ? "*" : ""}${expression})`;
  if (hasEngineMembers(schema, kind)) return `printedFlags(printer, ${expression})`;
  if (kind.tag === "PlacedWord") return isOptional ? `${expression}->value()` : `${expression}.value()`;
  if (isUInt8) return `static_cast<uint32_t>(${expression})`;
  return isOptional ? `*${expression}` : expression;
}

function hasEngineMembers(schema: Schema, kind: Kind): boolean {
  return kind.tag === "Flags" && kind.type.wireMemberCount > 0 && kind.type.wireMemberCount < kind.type.members.length;
}

function listPresenceTest(kind: ListKind, expression: string, isPayload: boolean): string {
  const element = kind.element;
  const isDecodedOnRead = isNested(element) || (element.tag === "Scalar" && twoWordScalars.has(element.scalar));
  const isStandardSpan = isPayload ? !isDecodedOnRead : isBorrowedSpan(kind);
  return isStandardSpan ? `!${expression}.empty()` : `!${expression}.isEmpty()`;
}

export function presenceTest(
  schema: Schema,
  kind: Kind,
  isOptional: boolean,
  expression: string,
  inAbi: boolean,
  forZeroTest = true,
): string | null {
  if (isList(kind)) return listPresenceTest(kind, expression, false);
  if (isNested(kind)) return canBeZero(schema, kind) ? `!isZero(${expression})` : null;
  if (inAbi) {
    if (isOptional) return `${expression} != UINT32_MAX`;
    if (isId(kind)) return null;
    return kind.tag === "Enum" || kind.tag === "Flags" ? `static_cast<uint32_t>(${expression})` : expression;
  }
  if (isId(kind)) return isOptional ? expression : null;
  if (isOptional) return expression;
  if (kind.tag === "Enum") {
    return kind.type.isGenerated
      ? `static_cast<uint32_t>(${expression})`
      : `${expression} != ${kind.type.name}::${kind.type.members[0].name}`;
  }
  if (kind.tag === "External") return `static_cast<uint32_t>(${expression})`;
  if (kind.tag === "Flags") {
    return hasEngineMembers(schema, kind) && !forZeroTest
      ? `!printedFlags(printer, ${expression}).isEmpty()`
      : `!${expression}.isEmpty()`;
  }
  if (kind.tag === "Scalar" && kind.scalar === "Double") return `std::bit_cast<uint64_t>(${expression})`;
  if (kind.tag === "PlacedWord") return `${expression}.value()`;
  return expression;
}

function printElement(schema: Schema, kind: Kind, inAbi: boolean): string {
  if (kind.tag === "Record") return "printRecord(printer, element);";
  if (kind.tag === "Variant") return "printVariant(printer, element);";
  return `printer.print(${typedValue(schema, kind, false, "element", inAbi)});`;
}

function valueStatements(schema: Schema, value: PrintedValue): string[] {
  const { kind, expression } = value;
  const name = cppLiteral(value.name);
  switch (kind.tag) {
    case "Record":
      return [`printer.beginField(${name});`, `printRecord(printer, ${expression});`];
    case "Variant":
      return [`printer.beginField(${name});`, `printVariant(printer, ${expression});`];
    case "Span":
    case "List":
      if (kind.element.tag === "Scalar" && kind.element.scalar === "Byte")
        return [`printer.field(${name}, ${expression});`];
      return [
        `printer.beginField(${name});`,
        `printer.list(${expression}, [&](const auto& element) {`,
        indentation + printElement(schema, kind.element, value.inAbi),
        "});",
      ];
    case "Scalar":
    case "Id":
    case "PlacedWord":
    case "Enum":
    case "Flags":
    case "External":
      return [`printer.field(${name}, ${typedValue(schema, kind, value.isOptional, expression, value.inAbi)});`];
  }
}

function printStatements(schema: Schema, value: PrintedValue): string[] {
  const { kind, expression } = value;
  const body = valueStatements(schema, value);
  const presence =
    value.isPayload && isList(kind)
      ? listPresenceTest(kind, expression, true)
      : presenceTest(schema, kind, value.isOptional, expression, value.inAbi, false);
  const test = value.guard === null ? presence : presence === null ? value.guard : `${value.guard} && ${presence}`;
  if (test === null) return body;
  if (body.length === 1) return [`if (${test})`, indentation + body[0]];
  return [`if (${test}) {`, ...indent(body), "}"];
}

function fieldsFunction(
  schema: Schema,
  typeName: string,
  fields: readonly Field[],
  inAbi: boolean,
  isStatic: boolean,
  isWire: boolean,
): string[] {
  const statementsOf = (field: Field): string[] =>
    printStatements(schema, {
      name: field.name,
      kind: field.kind,
      isOptional: field.isOptional,
      expression: `record.${field.name}`,
      inAbi,
      isPayload: false,
      guard: null,
    });
  const isEngineOnly = (field: Field): boolean => field.isEngine && isWire;
  const body = fields.filter(field => !isEngineOnly(field)).flatMap(statementsOf);
  const engine = fields.filter(isEngineOnly).flatMap(statementsOf);
  if (engine.length > 0) body.push("if (!printer.printsEngineFields())", `${indentation}return;`, ...engine);
  return [
    `${isStatic ? "static " : ""}void printFields(IRPrinter& printer, const ${typeName}& record)`,
    "{",
    ...indent(body.length > 0 ? body : ["UNUSED_PARAM(printer);", "UNUSED_PARAM(record);"]),
    "}",
  ];
}

function negated(test: string): string {
  if (test.startsWith("!")) return test.slice(1);
  if (test.includes(" != ")) return test.replaceAll(" != ", " == ");
  return `!${test}`;
}

function zeroTest(schema: Schema, field: Field, expression: string, inAbi: boolean): string {
  const test = presenceTest(schema, field.kind, field.isOptional, expression, inAbi);
  if (test === null) throw new Error(`${expression} always prints, so nothing tests it for zero`);
  return negated(test);
}

function zeroFunction(schema: Schema, type: SchemaType): string[] {
  if (type.tag === "Variant") {
    const name = type.variant.name;
    const first = type.variant.cases[0];
    const tests = [
      `variant.kind() == ${name}::Kind::${first.name}`,
      ...first.fields.map(field =>
        zeroTest(schema, field, `variant.as<${name}::${first.name}>().${field.name}`, false),
      ),
    ];
    return [`static bool isZero(const ${name}& variant)`, "{", `${indentation}return ${tests.join(" && ")};`, "}"];
  }
  if (type.record.form === "wire" && type.record.hasEngineFields) {
    const problem = `${type.record.name} is left out of IR text when it is zero, so it cannot have engine fields`;
    throw new SchemaError(type.record.location, problem);
  }
  const signature = `static bool isZero(const ${engineRecordNameOf(type.record)}& record)`;
  const inAbi = type.record.form === "abi";
  const tests = printedFields(schema, type).map(field => zeroTest(schema, field, `record.${field.name}`, inAbi));
  if (tests.length === 0) return [signature, "{", ...indent(["UNUSED_PARAM(record);", "return true;"]), "}"];
  const lines = pack(
    tests.map((test, index) => test + (index + 1 < tests.length ? " &&" : ";")),
    indentation.repeat(2),
  );
  lines[0] = `${indentation}return ${lines[0].trim()}`;
  return [signature, "{", ...lines, "}"];
}

function nestedTypeNames(schema: Schema): Set<string> {
  const kinds = printedTypes(schema).flatMap(type => printedFields(schema, type).map(field => field.kind));
  return new Set(kinds.filter(isNested).map(kind => nameOf(kind)));
}

function variantFunction(schema: Schema, variant: Variant): string[] {
  const cases = variant.cases.map(variantCase => ({
    label: variantCase.name,
    body:
      variantCase.fields.length === 0
        ? ["return;"]
        : [`printRecord(printer, variant.as<${variant.name}::${variantCase.name}>());`, "return;"],
  }));
  return [
    `void printVariant(IRPrinter& printer, const ${variant.name}& variant)`,
    "{",
    `${indentation}printer.out().print(nameOf(variant.kind()));`,
    `${indentation}switch (variant.kind()) {`,
    ...groupedCases(`${variant.name}::Kind`, cases),
    `${indentation}}`,
    `${indentation}RELEASE_ASSERT_NOT_REACHED();`,
    "}",
  ];
}

const printRecordHelpers = `template<typename F>
static OptionSet<F> printedFlags(IRPrinter& printer, OptionSet<F> flags)
{
    if (printer.printsEngineFields())
        return flags;
    constexpr auto wireMembers = static_cast<typename OptionSet<F>::StorageType>((uint64_t { 1 } << numberOfWireEnumerators<F>) - 1);
    return flags & OptionSet<F>::fromRaw(wireMembers);
}

template<typename Record>
static void printRecord(IRPrinter& printer, const Record& record)
{
    printer.beginRecord();
    printFields(printer, record);
    printer.endRecord();
}`.split("\n");

export function zeroFunctions(schema: Schema, names: ReadonlySet<string>): string[][] {
  return printedTypes(schema)
    .filter(type => names.has(nameOf(type)) && canBeZero(schema, type))
    .map(type => zeroFunction(schema, type));
}

function recordPrinterSource(schema: Schema): string[] {
  const types = printedTypes(schema);
  const casesWithFields = (variant: Variant) => variant.cases.filter(variantCase => variantCase.fields.length > 0);
  const functions = types.flatMap(type => {
    if (type.tag === "Record") {
      const { form } = type.record;
      return [
        fieldsFunction(
          schema,
          engineRecordNameOf(type.record),
          printedFields(schema, type),
          form === "abi",
          false,
          form === "wire",
        ),
      ];
    }
    const variant = type.variant;
    const caseFunctions = casesWithFields(variant).map(variantCase =>
      fieldsFunction(schema, `${variant.name}::${variantCase.name}`, variantCase.fields, false, true, false),
    );
    return [...caseFunctions, variantFunction(schema, variant)];
  });
  const caseDeclarations = types.flatMap(type => {
    if (type.tag === "Record") return [];
    return casesWithFields(type.variant).map(
      variantCase => `static void printFields(IRPrinter&, const ${type.variant.name}::${variantCase.name}&);`,
    );
  });
  const body = blocks(
    caseDeclarations,
    printRecordHelpers,
    ...zeroFunctions(schema, nestedTypeNames(schema)),
    ...functions,
  );
  return cppSource(['"AOTIRPrinter.h"', "<bit>"], inNamespace("Typed", body));
}

const entryHelpers = `template<typename Entry>
static void printOperands(IRPrinter& printer, const Instruction& instruction, Entry entry)
{
    Vector<ValueID, 8> operands;
    for (uint32_t i = 0; i < numberOfNamedOperandsOf(entry); ++i) {
        if (!operandInfoOf(entry, i).isEngineOnly)
            operands.append(instruction.operand(i));
    }
    operands.append(instruction.variadicOperands());
    while (!operands.isEmpty() && !operands.last())
        operands.removeLast();
    ASCIILiteral separator = " "_s;
    for (ValueID operand : operands) {
        printer.out().print(separator);
        if (operand)
            printer.print(operand);
        else
            printer.out().print("-"_s);
        separator = ", "_s;
    }
}`.split("\n");

function optionalByName(schema: Schema): Set<string> {
  const optionalFields = entriesOf(schema).flatMap(entry => entry.payload.filter(field => field.isOptional));
  return new Set(optionalFields.map(field => field.name));
}

function printEntry(schema: Schema, entry: Entry, subject: string, optionalNames: ReadonlySet<string>): string[] {
  const statements = entry.parameters.flatMap(parameter => {
    if (parameter.tag === "Operand") {
      if (!parameter.isEngine) return [];
      const operand = `${subject}.operand(${parameter.index})`;
      return [
        `if (printsEngineFields && ${operand})`,
        `${indentation}printer.field(${cppLiteral(parameter.name)}, ${operand});`,
      ];
    }
    return printStatements(schema, {
      name: parameter.name,
      kind: parameter.kind,
      isOptional: isId(parameter.kind) ? parameter.isOptional : optionalNames.has(parameter.name),
      expression: `${subject}.${parameter.name}()`,
      inAbi: false,
      isPayload: true,
      guard: parameter.isEngine ? "printsEngineFields" : null,
    });
  });
  return [...statements, "break;"];
}

function entryFunction(
  schema: Schema,
  entries: readonly Entry[],
  typeName: string,
  subject: string,
  tag: string,
  enumName: string,
): string[] {
  const optionalNames = optionalByName(schema);
  const cases = entries.map(entry => ({ label: entry.name, body: printEntry(schema, entry, subject, optionalNames) }));
  return [
    `void printFields(IRPrinter& printer, const ${typeName}& ${subject})`,
    "{",
    `${indentation}printOperands(printer, ${subject}, ${subject}.${tag});`,
    `${indentation}bool printsEngineFields = printer.printsEngineFields();`,
    `${indentation}UNUSED_VARIABLE(printsEngineFields);`,
    `${indentation}switch (${subject}.${tag}) {`,
    ...groupedCases(enumName, cases),
    `${indentation}}`,
    "}",
  ];
}

function entryPrinterSource(schema: Schema): string[] {
  const payloadKinds = entriesOf(schema).flatMap(entry => entry.payload.map(field => field.kind));
  const payloadTypes = payloadKinds.filter(isNested).map(kind => nameOf(kind));
  const body = blocks(
    printRecordHelpers,
    ...zeroFunctions(schema, closureOfZeroTests(schema, payloadTypes)),
    entryHelpers,
    entryFunction(schema, schema.operations, "Value", "value", "opcode", "Opcode"),
    entryFunction(schema, schema.terminators, "Terminator", "terminator", "kind", "TerminatorKind"),
  );
  return cppSource(['"AOTIRPrinter.h"', "<bit>"], inNamespace("Typed", body));
}

export function closureOfZeroTests(schema: Schema, names: Iterable<string>): Set<string> {
  const typesByName = new Map<string, SchemaType>(schema.types.map(type => [nameOf(type), type]));
  const closure = new Set<string>();
  const worklist = [...names];
  for (let name = worklist.pop(); name !== undefined; name = worklist.pop()) {
    if (closure.has(name)) continue;
    closure.add(name);
    const type = typesByName.get(name);
    if (type === undefined) throw new Error(`no record or variant is named ${name}`);
    if (!canBeZero(schema, type)) continue;
    for (const field of zeroTestedFields(schema, type)) {
      if (isNested(field.kind)) worklist.push(nameOf(field.kind));
    }
  }
  return closure;
}

export function emitCppPrinter(context: EmitContext): OutputFile[] {
  const { schema } = context;
  return [
    { name: "AOTSchemaPrinter.h", lines: printerHeader(schema) },
    { name: "AOTSchemaRecordPrinter.cpp", lines: recordPrinterSource(schema) },
    { name: "AOTSchemaEntryPrinter.cpp", lines: entryPrinterSource(schema) },
  ];
}
