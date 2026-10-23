import type {
  AllocationResult,
  DeclaredResult,
  EntryColumnValue,
  IntegerRange,
  Kind,
  NaturalRow,
  NaturalTable,
  OpaqueKind,
  Operand,
  OperandClass,
  Parameter,
  PayloadField,
  PrimitiveWord,
  Result,
  ResultRule,
  SchemaEnum,
  Target,
  TypeExpression,
} from "./model.ts";
import { resultRules } from "./model.ts";
import { upperFirst } from "./names.ts";
import type { DeclarationInFile } from "./parse.ts";
import type { Scope } from "./resolve.ts";
import type {
  Name,
  NaturalSyntax,
  ResultSyntax,
  RuleSyntax,
  TargetSyntax,
  TypeSyntax,
  TypeWordSyntax,
} from "./syntax.ts";

export interface EntryParts {
  readonly name: string;
  readonly parameters: readonly Parameter[];
  readonly columns: ReadonlyMap<string, EntryColumnValue>;
}

type TypePart =
  | { readonly tag: "Primitives"; readonly primitives: readonly PrimitiveWord[] }
  | { readonly tag: "Integers"; readonly range: IntegerRange }
  | { readonly tag: "Object" | "Function" | "Never" }
  | { readonly tag: "Opaque"; readonly opaque: OpaqueKind }
  | { readonly tag: "BuiltinClass"; readonly builtinClass: string };

const fixedTypeWords: ReadonlyMap<string, TypePart> = new Map<string, TypePart>([
  ["undefined", { tag: "Primitives", primitives: ["Undefined"] }],
  ["null", { tag: "Primitives", primitives: ["Null"] }],
  ["boolean", { tag: "Primitives", primitives: ["False", "True"] }],
  ["number", { tag: "Primitives", primitives: ["Number"] }],
  ["string", { tag: "Primitives", primitives: ["String"] }],
  ["symbol", { tag: "Primitives", primitives: ["Symbol"] }],
  ["bigint", { tag: "Primitives", primitives: ["BigInt"] }],
  ["int32", { tag: "Integers", range: { minimum: -2147483648n, maximum: 2147483647n } }],
  ["uint32", { tag: "Integers", range: { minimum: 0n, maximum: 4294967295n } }],
  ["object", { tag: "Object" }],
  ["function", { tag: "Function" }],
  ["never", { tag: "Never" }],
]);

const operandClassWords: ReadonlyMap<string, OperandClass> = new Map<string, OperandClass>([
  ["numberLike", "NumberLike"],
  ["bigint", "BigInt"],
  ["string", "String"],
  ["any", "Any"],
]);

const declaredIdKinds = ["Variable", "Function", "Layout", "Module", "Type"] as const;
const unknownRule: ResultRule = { rule: "Unknown" };

function typeWordText(syntax: TypeWordSyntax): string {
  if (syntax.range !== null) return `int[${syntax.range[0]},${syntax.range[1]}]`;
  return syntax.sameAs === null ? syntax.word.text : `same(${syntax.sameAs.text})`;
}

function typeText(syntax: TypeSyntax): string {
  return syntax.words.map(typeWordText).join("|");
}

function listsMember(scope: Scope, externalName: string, member: string): boolean {
  return scope.externals.get(externalName)?.members.includes(member) ?? false;
}

function findDeclaredEnum(scope: Scope, name: string): SchemaEnum | null {
  const type = scope.enums.get(name);
  return type !== undefined && !type.isFlags && !type.isGenerated ? type : null;
}

function findTypePart(scope: Scope, syntax: TypeWordSyntax): TypePart | null {
  if (syntax.sameAs !== null) return null;
  if (syntax.range !== null) return { tag: "Integers", range: { minimum: syntax.range[0], maximum: syntax.range[1] } };
  const word = syntax.word.text;
  const fixed = fixedTypeWords.get(word);
  if (fixed !== undefined) return fixed;
  if (word === "integer") {
    const tracked = scope.constants.get("MaxTrackedInteger");
    if (tracked !== undefined) return { tag: "Integers", range: { minimum: -tracked.value, maximum: tracked.value } };
    scope.errors.add(syntax.word.location, "the type word integer needs the constant MaxTrackedInteger");
    return { tag: "Never" };
  }
  const opaque = scope.opaqueKinds.get(word);
  if (opaque !== undefined) return { tag: "Opaque", opaque };
  if (listsMember(scope, "BuiltinClass", word)) return { tag: "BuiltinClass", builtinClass: word };
  const type = findDeclaredEnum(scope, word);
  return type === null ? null : { tag: "Integers", range: { minimum: 0n, maximum: BigInt(type.members.length - 1) } };
}

function joinRanges(first: IntegerRange | null, second: IntegerRange): IntegerRange {
  if (first === null) return second;
  return {
    minimum: first.minimum < second.minimum ? first.minimum : second.minimum,
    maximum: first.maximum > second.maximum ? first.maximum : second.maximum,
  };
}

function joinTypeParts(text: string, parts: readonly TypePart[]): TypeExpression {
  const primitives: PrimitiveWord[] = [];
  let integers: IntegerRange | null = null;
  let isObject = false;
  let isFunction = false;
  let opaque: OpaqueKind | null = null;
  let builtinClass: string | null = null;
  for (const part of parts) {
    switch (part.tag) {
      case "Primitives":
        primitives.push(...part.primitives.filter(primitive => !primitives.includes(primitive)));
        break;
      case "Integers":
        integers = joinRanges(integers, part.range);
        break;
      case "Object":
        isObject = true;
        break;
      case "Function":
        isFunction = true;
        break;
      case "Never":
        break;
      case "Opaque":
        opaque ??= part.opaque;
        break;
      case "BuiltinClass":
        if (builtinClass === null || builtinClass === part.builtinClass) builtinClass = part.builtinClass;
        else isObject = true;
        break;
    }
  }
  return { text, primitives, integers, isObject, isFunction, opaque, builtinClass };
}

export function resolveType(scope: Scope, syntax: TypeSyntax): TypeExpression {
  const parts: TypePart[] = [];
  for (const word of syntax.words) {
    const part = findTypePart(scope, word);
    if (part === null) scope.errors.add(word.word.location, `unknown type word ${typeWordText(word)}`);
    else parts.push(part);
  }
  return joinTypeParts(typeText(syntax), parts);
}

function resolveOperandClass(scope: Scope, word: Name): OperandClass {
  const operandClass = operandClassWords.get(word.text);
  if (operandClass !== undefined) return operandClass;
  scope.errors.add(word.location, `unknown operand class ${word.text}`);
  return "Any";
}

function resolveNaturalTable(scope: Scope, syntax: NaturalSyntax): void {
  const { name } = syntax;
  const rows: NaturalRow[] = syntax.rows.map(row => ({
    classes: row.classes.map(word => resolveOperandClass(scope, word)),
    type: resolveType(scope, row.type),
  }));
  const arity = rows.at(0)?.classes.length ?? 0;
  if (rows.some(row => row.classes.length !== arity))
    scope.errors.add(name.location, `the rows of ${name.text} differ in length`);
  if (syntax.otherwise === null) scope.errors.add(name.location, `${name.text} has no else`);
  const otherwise = syntax.otherwise === null ? joinTypeParts("never", []) : resolveType(scope, syntax.otherwise);
  const table: NaturalTable = {
    name: name.text,
    number: scope.naturalTables.size,
    arity,
    rows,
    otherwise,
    location: name.location,
  };
  scope.declare(scope.naturalTables, name, table, [scope.enums, scope.opaqueKinds]);
}

export function resolveNaturalTables(scope: Scope, declarations: readonly DeclarationInFile[]): void {
  for (const { declaration } of declarations) {
    if (declaration.declares === "natural") resolveNaturalTable(scope, declaration);
  }
}

function operandsOf(entry: EntryParts): Operand[] {
  return entry.parameters.flatMap(parameter => (parameter.tag === "Operand" ? [parameter] : []));
}

function payloadOf(entry: EntryParts): PayloadField[] {
  return entry.parameters.flatMap(parameter => (parameter.tag === "Payload" ? [parameter] : []));
}

function isIdOf(kind: Kind, idKindName: string): boolean {
  return kind.tag === "Id" && kind.id.name === idKindName;
}

function findIdPayload(entry: EntryParts, name: string, idKindName: string): PayloadField | null {
  return payloadOf(entry).find(field => field.name === name && isIdOf(field.kind, idKindName)) ?? null;
}

function resolveCast(scope: Scope, syntax: RuleSyntax, entry: EntryParts): ResultRule {
  const operands = operandsOf(entry);
  const returned = operands.find(operand => operand.uses.uses.some(use => use.name === "Returns")) ?? operands.at(0);
  if (returned === undefined) {
    scope.errors.add(syntax.rule.location, `${entry.name} is a cast and returns no operand`);
    return unknownRule;
  }
  const { argument } = syntax;
  if (argument === null) return { rule: "Cast", returned, type: null };
  const type = findIdPayload(entry, argument.text, "Type");
  if (type === null)
    scope.errors.add(argument.location, `cast(${argument.text}) of ${entry.name} does not name a Type field`);
  return { rule: "Cast", returned, type };
}

function resolveNatural(scope: Scope, syntax: RuleSyntax, entry: EntryParts): ResultRule {
  const { type } = syntax;
  if (type === null) {
    scope.errors.add(syntax.rule.location, `natural of ${entry.name} does not name a table or a type`);
    return unknownRule;
  }
  if (type.words.length !== 1) return { rule: "Natural", natural: { tag: "Type", type: resolveType(scope, type) } };
  const [word] = type.words;
  const { sameAs } = word;
  if (sameAs !== null) {
    const operand = operandsOf(entry).find(candidate => candidate.name === sameAs.text);
    if (operand !== undefined) return { rule: "Natural", natural: { tag: "SameAs", operand } };
    scope.errors.add(sameAs.location, `same(${sameAs.text}) of ${entry.name} does not name an operand`);
    return unknownRule;
  }
  const table = word.range === null ? scope.naturalTables.get(word.word.text) : undefined;
  if (table !== undefined) return { rule: "Natural", natural: { tag: "Table", table } };
  const part = findTypePart(scope, word);
  if (part !== null) return { rule: "Natural", natural: { tag: "Type", type: joinTypeParts(typeText(type), [part]) } };
  scope.errors.add(word.word.location, `natural(${typeText(type)}) of ${entry.name} does not name a table or a type`);
  return unknownRule;
}

function findAllocation(scope: Scope, name: string, entry: EntryParts): AllocationResult | null {
  const layout = findIdPayload(entry, name, "Layout");
  if (layout !== null) return { tag: "Layout", layout };
  if (listsMember(scope, "BuiltinClass", name)) return { tag: "Class", builtinClass: name, contents: null };
  return listsMember(scope, "BuiltinLayout", name) ? { tag: "BuiltinLayout", builtinLayout: name } : null;
}

function resolveAllocation(scope: Scope, syntax: RuleSyntax, entry: EntryParts): ResultRule {
  const { argument, contents } = syntax;
  const name = argument?.text ?? "";
  const allocation = findAllocation(scope, name, entry);
  if (allocation === null) {
    scope.errors.add(
      (argument ?? syntax.rule).location,
      `allocation(${name}) of ${entry.name} does not name a Layout field`,
    );
    return unknownRule;
  }
  if (contents === null) return { rule: "Allocation", allocation };
  const subject = `allocation(${name}<${contents.text}>) of ${entry.name}`;
  if (allocation.tag !== "Class") {
    scope.errors.add(contents.location, `${subject}: only a BuiltinClass has contents`);
    return { rule: "Allocation", allocation };
  }
  const contentsField = findIdPayload(entry, contents.text, "Type");
  if (contentsField === null) scope.errors.add(contents.location, `${subject} does not name a Type field`);
  return { rule: "Allocation", allocation: { ...allocation, contents: contentsField } };
}

function resolveDeclaredPayload(
  scope: Scope,
  field: PayloadField,
  argument: Name,
  entry: EntryParts,
): DeclaredResult | null {
  const { kind } = field;
  const subject = `declared(${argument.text}) of ${entry.name}`;
  const idKindName = kind.tag === "Id" ? kind.id.name : null;
  const tag = declaredIdKinds.find(candidate => candidate === idKindName);
  if (tag !== undefined) return { tag, field };
  if (kind.tag === "External" && kind.external.name === "BuiltinOverload") return { tag: "Overload", field };
  if (kind.tag === "Scalar" && kind.scalar === "Field") {
    const layouts = payloadOf(entry).filter(candidate => isIdOf(candidate.kind, "Layout"));
    if (layouts.length === 1) return { tag: "Field", layout: layouts[0], field };
    scope.errors.add(argument.location, `${subject} is ambiguous: ${entry.name} has ${layouts.length} Layout fields`);
    return null;
  }
  if (idKindName === "PropertyKey") {
    const receiver = entry.columns.get("receiver");
    if (receiver?.tag === "Operand") return { tag: "Key", key: field, receiver: receiver.operand };
    scope.errors.add(argument.location, `${subject} needs receiver`);
    return null;
  }
  scope.errors.add(argument.location, `${subject} does not name anything with a declared type`);
  return null;
}

function resolveResultAt(scope: Scope, producer: Operand, argument: Name, entry: EntryParts): DeclaredResult | null {
  const indexes = payloadOf(entry).filter(({ kind }) => kind.tag === "Scalar" && kind.scalar === "UInt32");
  if (indexes.length === 1) return { tag: "ResultAt", producer, index: indexes[0] };
  const problem = `is ambiguous: ${entry.name} has ${indexes.length} UInt32 fields`;
  scope.errors.add(argument.location, `declared(${argument.text}) of ${entry.name} ${problem}`);
  return null;
}

function resolveDeclaredParameter(
  scope: Scope,
  argument: Name,
  entry: EntryParts,
  resultName: string | null,
): DeclaredResult | null {
  const parameter = entry.parameters.find(candidate => candidate.name === argument.text);
  if (parameter === undefined) {
    scope.errors.add(argument.location, `declared(${argument.text}) of ${entry.name} does not name a parameter`);
    return null;
  }
  if (parameter.tag === "Payload") return resolveDeclaredPayload(scope, parameter, argument, entry);
  if (parameter.kind.name === "Results") return resolveResultAt(scope, parameter, argument, entry);
  const slot = scope.enums.get("ContentsSlot")?.members.find(member => member.name === resultName) ?? null;
  return { tag: "Contents", operand: parameter, slot };
}

function resolveDeclared(scope: Scope, syntax: RuleSyntax, entry: EntryParts, resultName: string | null): ResultRule {
  if (syntax.argument === null) return { rule: "Declared", declared: { tag: "BlockParameter" } };
  const declared = resolveDeclaredParameter(scope, syntax.argument, entry, resultName);
  return declared === null ? unknownRule : { rule: "Declared", declared };
}

function resolveResults(scope: Scope, syntax: RuleSyntax, entry: EntryParts): ResultRule {
  const indexEnum = syntax.indexEnum === null ? null : findDeclaredEnum(scope, syntax.indexEnum.text);
  if (syntax.indexEnum !== null && indexEnum === null) {
    scope.errors.add(
      syntax.indexEnum.location,
      `results(${syntax.indexEnum.text}: ..) of ${entry.name} does not name an enum`,
    );
  }
  const results = syntax.results.map((result, index) => {
    return resolveNamedResult(scope, result, entry, indexEnum?.members.at(index)?.name ?? null);
  });
  return { rule: "Results", indexEnum, results, isOpen: syntax.isOpen };
}

function resolveRule(scope: Scope, syntax: RuleSyntax, entry: EntryParts, resultName: string | null): ResultRule {
  const rule = resultRules.find(candidate => candidate === upperFirst(syntax.rule.text));
  switch (rule) {
    case undefined:
      scope.errors.add(syntax.rule.location, `unknown result rule ${syntax.rule.text}`);
      return unknownRule;
    case "None":
    case "Constant":
    case "Unknown":
      return { rule };
    case "Cast":
      return resolveCast(scope, syntax, entry);
    case "Natural":
      return resolveNatural(scope, syntax, entry);
    case "Allocation":
      return resolveAllocation(scope, syntax, entry);
    case "Declared":
      return resolveDeclared(scope, syntax, entry, resultName);
    case "Results":
      return resolveResults(scope, syntax, entry);
  }
}

function resolveNamedResult(scope: Scope, syntax: ResultSyntax, entry: EntryParts, resultName: string | null): Result {
  return {
    unproven: resolveRule(scope, syntax.unproven, entry, resultName),
    proven: syntax.proven === null ? null : resolveRule(scope, syntax.proven, entry, resultName),
  };
}

export function resolveResult(scope: Scope, syntax: ResultSyntax, entry: EntryParts): Result {
  return resolveNamedResult(scope, syntax, entry, null);
}

export function resolveTargets(scope: Scope, targets: readonly TargetSyntax[], entry: EntryParts): Target[] {
  return targets.map((target, index) => ({
    name: target.name.text,
    index,
    isVariadic: target.isVariadic,
    takesProofs: target.takesProofs,
    results: target.results.map(result => resolveResult(scope, result, entry)),
    location: target.name.location,
  }));
}
