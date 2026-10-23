import { equalsIgnoringRoles, findIndexFieldOfElements, nonzeroMemberOf } from "./check-entries.ts";
import { kindText } from "./hash.ts";
import type {
  DeclaredResult,
  Effects,
  Entry,
  HeapReference,
  NaturalResult,
  NaturalTable,
  OperandClass,
  Result,
  ResultRule,
  Schema,
  TypeExpression,
} from "./model.ts";
import { entriesOf, operandClasses } from "./model.ts";
import { lowerFirst } from "./names.ts";
import type { ErrorList, Location } from "./source.ts";

const trackedIntegerConstant = "MaxTrackedInteger";
const rangeWord = /^int\[(-?\d+),(-?\d+)\]$/;

interface Context {
  readonly errors: ErrorList;
  readonly maxTrackedInteger: bigint | null;
}

interface EffectsOwner {
  readonly name: string;
  readonly location: Location;
}

type EffectsOwnerKind = "effects" | "entry" | "runtime" | "inline";
type ResultList = Extract<ResultRule, { rule: "Results" }>;

const ownersNamingAllHeaps: ReadonlySet<EffectsOwnerKind> = new Set<EffectsOwnerKind>(["effects", "runtime"]);

function checkRanges(words: readonly string[], location: Location, context: Context): void {
  const limit = context.maxTrackedInteger;
  for (const word of words) {
    const bounds = rangeWord.exec(word);
    if (bounds === null) continue;
    const minimum = BigInt(bounds[1]);
    const maximum = BigInt(bounds[2]);
    if (minimum > maximum) {
      context.errors.add(location, `${word} is an empty range`);
    } else if (limit !== null && (minimum < -limit || maximum > limit)) {
      context.errors.add(location, `${word} exceeds ${trackedIntegerConstant}`);
    }
  }
}

function checkTypeExpression(type: TypeExpression, location: Location, context: Context): void {
  const { errors } = context;
  const { builtinClass, text } = type;
  const words = text.split("|");
  checkRanges(words, location, context);
  if (type.opaque !== null && words.length > 1) errors.add(location, "an opaque kind cannot be part of a union");
  const holdsAnyObject = type.isObject || type.isFunction;
  if (builtinClass !== null && holdsAnyObject) {
    errors.add(location, `${text}: ${builtinClass} cannot be joined with another object type`);
  }
  if (type.integers !== null && (holdsAnyObject || builtinClass !== null)) {
    errors.add(location, `${text}: a natural type cannot hold both integers and objects`);
  }
}

function isInside(inner: TypeExpression, outer: TypeExpression): boolean {
  const holdsIntegers =
    inner.integers === null ||
    outer.primitives.includes("Number") ||
    (outer.integers !== null &&
      outer.integers.minimum <= inner.integers.minimum &&
      inner.integers.maximum <= outer.integers.maximum);
  return (
    holdsIntegers &&
    inner.primitives.every(primitive => outer.primitives.includes(primitive)) &&
    (!inner.isObject || outer.isObject) &&
    (!inner.isFunction || outer.isFunction || outer.isObject) &&
    (inner.builtinClass === null || inner.builtinClass === outer.builtinClass || outer.isObject) &&
    (inner.opaque === null || inner.opaque === outer.opaque)
  );
}

function classTuples(arity: number): OperandClass[][] {
  if (arity === 0) return [[]];
  return classTuples(arity - 1).flatMap(tuple => operandClasses.map(operandClass => [...tuple, operandClass]));
}

function typePickedFor(table: NaturalTable, classes: readonly OperandClass[]): TypeExpression {
  const row = table.rows.find(candidate =>
    candidate.classes.every((wanted, index) => wanted === "Any" || wanted === classes[index]),
  );
  return row?.type ?? table.otherwise;
}

// A type only grows while values are typed, and a wider operand has the class Any.
function checkTableIsMonotone(table: NaturalTable, errors: ErrorList): void {
  for (const classes of classTuples(table.arity)) {
    classes.forEach((operandClass, index) => {
      if (operandClass === "Any") return;
      const wider = classes.with(index, "Any");
      const [type, widerType] = [typePickedFor(table, classes), typePickedFor(table, wider)];
      if (isInside(type, widerType)) return;
      const rows = `(${classes.join(", ")}) gives ${type.text} and (${wider.join(", ")}) gives ${widerType.text}`;
      errors.add(table.location, `natural table ${table.name} is not monotone: ${rows}`);
    });
  }
}

function checkNaturalTables(schema: Schema, context: Context): void {
  for (const table of schema.naturalTables) {
    for (const row of table.rows) checkTypeExpression(row.type, table.location, context);
    checkTypeExpression(table.otherwise, table.location, context);
    checkTableIsMonotone(table, context.errors);
  }
}

function hasOperandWithUse(entry: Entry, use: string): boolean {
  return entry.parameters.some(
    parameter => parameter.tag === "Operand" && parameter.uses.uses.some(member => member.name === use),
  );
}

function hasPayloadField(entry: Entry, name: string): boolean {
  return entry.payload.some(field => field.name === name);
}

function checkNaturalRule(entry: Entry, natural: NaturalResult, context: Context): void {
  switch (natural.tag) {
    case "SameAs":
      // Whoever follows pointers asks the uses, not the rule of the type.
      if (natural.operand.uses.uses.some(member => member.name === "Returns")) return;
      context.errors.add(
        natural.operand.location,
        `${entry.name} answers its operand ${natural.operand.name}, which does not say returns`,
      );
      return;
    case "Table": {
      const { arity, location, name } = natural.table;
      const count = entry.namedOperands.length;
      if (count === arity && entry.variadicOperand === null) return;
      context.errors.add(location, `natural table ${name} takes ${arity} operands and ${entry.name} has ${count}`);
      return;
    }
    case "Type":
      checkTypeExpression(natural.type, entry.location, context);
      if (natural.type.opaque?.isInterior && !entry.columns.has("base")) {
        context.errors.add(entry.location, `${entry.name} has an interior result but no base`);
      }
      return;
  }
}

function checkResultList(entry: Entry, list: ResultList, context: Context): void {
  const { indexEnum, isOpen, results } = list;
  if (!isOpen && results.length === 0) context.errors.add(entry.location, `results of ${entry.name} lists no result`);
  if (indexEnum !== null && isOpen) {
    context.errors.add(entry.location, `results(${indexEnum.name}: ..) of ${entry.name} is an open list`);
  } else if (indexEnum !== null && indexEnum.members.length !== results.length) {
    const memberCount = `${indexEnum.name} has ${indexEnum.members.length} members`;
    context.errors.add(entry.location, `${entry.name} has ${results.length} results and ${memberCount}`);
  }
  results.forEach((result, index) => checkResult(entry, result, index, context));
}

function checkRule(entry: Entry, rule: ResultRule, isNested: boolean, context: Context): void {
  switch (rule.rule) {
    case "None":
    case "Constant":
    case "Unknown":
    case "Allocation":
    case "Declared":
      return;
    case "Cast":
      if (hasOperandWithUse(entry, "Returns")) return;
      context.errors.add(entry.location, `${entry.name} is a cast and returns no operand`);
      return;
    case "Natural":
      checkNaturalRule(entry, rule.natural, context);
      return;
    case "Results":
      if (isNested) context.errors.add(entry.location, `results(..) of ${entry.name} cannot contain results`);
      else checkResultList(entry, rule, context);
      return;
  }
}

function checkResult(entry: Entry, result: Result, index: number, context: Context): void {
  const { proven, unproven } = result;
  const { location, name } = entry;
  if (proven === null) {
    checkRule(entry, unproven, true, context);
    return;
  }
  for (const side of [unproven, proven]) {
    if (side.rule === "Results") context.errors.add(location, `results(..) of ${name} cannot be a side of =>`);
    else checkRule(entry, side, true, context);
  }
  if (proven.rule === "None") {
    context.errors.add(location, `the proven rule of ${name} for result ${index} is none`);
  } else if (proven.rule === "Allocation" && unproven.rule === "Allocation") {
    context.errors.add(location, `${name} has two allocation rules`);
  } else if (proven.rule === unproven.rule && proven.rule !== "Results") {
    context.errors.add(location, `${name} has two ${lowerFirst(proven.rule)} rules for result ${index}`);
  }
}

function isLegalOnEdge(rule: ResultRule): boolean {
  switch (rule.rule) {
    case "None":
    case "Unknown":
      return true;
    case "Natural":
      return rule.natural.tag !== "Table";
    case "Declared":
      return rule.declared.tag === "Overload";
    case "Constant":
    case "Allocation":
    case "Cast":
    case "Results":
      return false;
  }
}

function declaredArgumentOf(declared: DeclaredResult): string | null {
  switch (declared.tag) {
    case "BlockParameter":
      return null;
    case "Variable":
    case "Function":
    case "Layout":
    case "Module":
    case "Type":
    case "Overload":
    case "Field":
      return declared.field.name;
    case "Key":
      return declared.key.name;
    case "Contents":
      return declared.operand.name;
    case "ResultAt":
      return declared.producer.name;
  }
}

function ruleText(rule: ResultRule): string {
  const word = lowerFirst(rule.rule);
  if (rule.rule === "Natural" && rule.natural.tag === "Table") return `${word}(${rule.natural.table.name})`;
  const argument = rule.rule === "Declared" ? declaredArgumentOf(rule.declared) : null;
  return argument === null ? word : `${word}(${argument})`;
}

function checkEdgeResults(entry: Entry, context: Context): void {
  const firstVariadic = entry.targets.findIndex(target => target.isVariadic);
  for (const target of entry.targets) {
    if (firstVariadic >= 0 && target.index >= firstVariadic && target.results.length > 0) {
      const position = target.isVariadic ? "is variadic" : "follows a variadic target";
      context.errors.add(target.location, `target ${target.name} of ${entry.name} ${position} and has results`);
    }
    target.results.forEach((result, index) => {
      const sides = result.proven === null ? [result.unproven] : [result.unproven, result.proven];
      const illegalRules = sides.filter(rule => !isLegalOnEdge(rule));
      for (const rule of illegalRules) {
        const subject = `result ${index} on target ${target.name} of ${entry.name}`;
        context.errors.add(target.location, `${subject}: rule ${ruleText(rule)} is not legal on an edge`);
      }
      if (illegalRules.length === 0) checkResult(entry, result, index, context);
    });
  }
}

function checkHeapIndexes(owner: EffectsOwner, reference: HeapReference, errors: ErrorList): void {
  const { heap, indexes } = reference;
  indexes.forEach((index, position) => {
    const declaredKind = heap.indexKinds[position];
    if (index.tag !== "Payload" || declaredKind === undefined) return;
    const { kind, name } = index.field;
    if (equalsIgnoringRoles(kind, declaredKind)) return;
    if (indexes.length === 1 && findIndexFieldOfElements(kind, declaredKind) !== null) return;
    const kinds = `has kind ${kindText(kind)}, and ${heap.name} is indexed by ${kindText(declaredKind)}`;
    errors.add(owner.location, `index ${name} of heap ${heap.name} in ${owner.name} ${kinds}`);
  });
}

function hasMoreThanSuspends(effects: Effects): boolean {
  const namesAllHeaps = effects.readsAllHeaps || effects.writesAllHeaps;
  const namesHeaps = namesAllHeaps || effects.reads.length > 0 || effects.writes.length > 0;
  return namesHeaps || effects.isAsOverload || effects.throws || effects.collects || effects.terminates;
}

function checkEffects(owner: EffectsOwner, effects: Effects, kind: EffectsOwnerKind, errors: ErrorList): void {
  const { location, name } = owner;
  if (effects.isUnknownCode && hasMoreThanSuspends(effects)) {
    errors.add(location, `unknownCode of ${name} stands with more than suspends`);
  }
  if (effects.writesAllHeaps) errors.add(location, `all of ${name}: only reads may name all heaps`);
  if ((effects.readsAllHeaps || effects.writesAllHeaps) && !ownersNamingAllHeaps.has(kind)) {
    errors.add(location, `all of ${name}: only a run-time row names all heaps`);
  }
  for (const reference of [...effects.reads, ...effects.writes]) checkHeapIndexes(owner, reference, errors);
}

function checkEffectRule(entry: Entry, errors: ErrorList): void {
  const subject = `${entry.name} refines its effects by ${entry.effectRule}`;
  switch (entry.effectRule) {
    case "Declared":
    case "Operator":
      return;
    case "Access":
      if (nonzeroMemberOf(entry, "accessClass") !== null) return;
      errors.add(entry.location, `${subject} and has no accessClass`);
      return;
    case "Call":
      if (hasOperandWithUse(entry, "Calls") || hasPayloadField(entry, "function")) return;
      errors.add(entry.location, `${subject} and has neither an operand with the use calls nor a function`);
      return;
    case "Builtin":
    case "Inline":
      if (!hasPayloadField(entry, "overload")) errors.add(entry.location, `${subject} and has no overload`);
      return;
  }
}

export function checkResults(schema: Schema, errors: ErrorList): void {
  const maxTrackedInteger = schema.constants.find(constant => constant.name === trackedIntegerConstant)?.value ?? null;
  const context: Context = { errors, maxTrackedInteger };
  checkNaturalTables(schema, context);
  for (const set of schema.namedEffects) checkEffects(set, set.effects, "effects", errors);
  for (const entry of entriesOf(schema)) {
    if (entry.result.proven === null) checkRule(entry, entry.result.unproven, false, context);
    else checkResult(entry, entry.result, 0, context);
    checkEdgeResults(entry, context);
    checkEffects(entry, entry.effects, "entry", errors);
    checkEffectRule(entry, errors);
  }
  for (const operation of schema.runtimeOperations) checkEffects(operation, operation.effects, "runtime", errors);
  for (const builtin of schema.inlineBuiltins) checkEffects(builtin, builtin.effects, "inline", errors);
}
