import type { Problems } from "./declarations.ts";
import { describeOperand, parameterAt } from "./dispatch.ts";
import type {
  ModelBuiltin,
  ModelCalledFunction,
  ModelHostCall,
  ModelHostUse,
  ModelHostUses,
  ModelHostValue,
  ModelModuleLoad,
  ModelName,
  ModelOperand,
  ModelOverload,
  ModelPlace,
  TableModel,
} from "./model.ts";
import type { BuiltinKind } from "./vocabulary.ts";

type CheckedModel = Pick<
  TableModel,
  "builtins" | "overloads" | "startup" | "hostObjects" | "namedMemberCalls" | "hostMethodCalls"
>;

interface DescribedUses {
  /** Names the row, as a message starts. */
  row: string;
  uses: ModelHostUses;
}

interface DescribedValue {
  row: string;
  value: ModelHostValue;
}

const maximumInternalFieldIndex = 0xff;
const maximumArgumentIndex = 0xff;

const kindsHoldingValues: readonly BuiltinKind[] = ["Constructor", "Function", "Method", "Accessor", "DataProperty"];

const describeOwner = (builtin: ModelBuiltin | null): string => (builtin === null ? "start-up" : builtin.text);

function usesOfLoads(owner: ModelBuiltin | null, loads: readonly ModelModuleLoad[]): DescribedUses[] {
  return loads.flatMap(({ module, exports }) =>
    (exports ?? []).map(({ name, uses }) => ({
      row: `${describeOwner(owner)} reads ${name.text} of ${module.specifier}`,
      uses,
    })),
  );
}

function usesOfCalledFunctions(owner: ModelBuiltin | null, called: readonly ModelCalledFunction[]): DescribedUses[] {
  return called.map(({ function: { file, name }, uses }) => ({
    row: `${describeOwner(owner)} uses ${name} of ${file}`,
    uses,
  }));
}

function collectWrittenUses(model: CheckedModel): DescribedUses[] {
  return [
    ...model.builtins.flatMap(builtin => [
      ...usesOfLoads(builtin, builtin.attachments.moduleLoads),
      ...usesOfCalledFunctions(builtin, builtin.attachments.calledFunctions),
    ]),
    ...usesOfLoads(null, model.startup.loads),
    ...usesOfCalledFunctions(null, model.startup.functionsCalledWithLoads),
    ...model.hostObjects.flatMap(({ cell, internalFields }) =>
      internalFields.map(({ index, uses }) => ({
        row: `internal field ${index} of the host object ${cell.text}`,
        uses,
      })),
    ),
    ...model.hostMethodCalls.map(({ name, cell, call }) => ({
      row: `a host method named ${name.text} uses what lies in ${cell.text}`,
      uses: [{ path: [], read: "Called", call }] satisfies ModelHostUse[],
    })),
  ];
}

const valuesOfCall = ({ thisValue, arguments: passed, otherArguments }: ModelHostCall): ModelHostValue[] => [
  thisValue,
  ...(passed ?? []),
  otherArguments,
];

function forEachUse(uses: ModelHostUses, visit: (use: ModelHostUse) => void): void {
  for (const use of uses ?? []) {
    visit(use);
    if (use.read === "Called" && use.call !== null) forEachUse(use.call.result, visit);
  }
}

function checkPassedArgument(row: string, builtin: ModelBuiltin, argument: number, problems: Problems): void {
  const position: ModelOperand = { operand: "Argument", index: argument };
  if (!Number.isInteger(argument) || argument < 0 || argument > maximumArgumentIndex) {
    problems.add(null, `${row}: ${argument} is no index of an argument`);
    return;
  }
  const takesArgument = builtin.overloads.some(
    overload => overload.mode === "Call" && parameterAt(overload, position) !== null,
  );
  if (takesArgument) return;
  problems.add(null, `${row}: it is passed to ${builtin.text}, and no Call overload has ${describeOperand(position)}`);
}

function checkCall(row: string, call: ModelHostCall, problems: Problems): void {
  if (call.arguments === null && call.otherArguments.place !== "None") {
    problems.add(null, `${row}: otherArgs follows a list of arguments, and the call has none`);
  }
  for (const value of valuesOfCall(call)) {
    if (value.place !== "NewValue") continue;
    const { isAnything, hasAnyObject, hasAnyFunction, hasPlainData, primitives, integers, stringLiterals, parts } =
      value.type;
    const isNever =
      !isAnything &&
      !hasAnyObject &&
      !hasAnyFunction &&
      !hasPlainData &&
      integers === null &&
      primitives.length + stringLiterals.length + parts.length === 0;
    if (isNever) problems.add(null, `${row}: native code passes a value that has no type`);
  }
}

function checkUse(row: string, use: ModelHostUse, problems: Problems): void {
  switch (use.read) {
    case "Inspected":
    case "Kept":
      return;
    case "Called":
      if (use.call !== null) checkCall(row, use.call, problems);
      return;
    case "PassedTo":
      checkPassedArgument(row, use.builtin, use.argument, problems);
      return;
    case "IsValueOf":
      if (kindsHoldingValues.includes(use.builtin.kind)) return;
      problems.add(
        null,
        `${row}: it is the value of ${use.builtin.text}, and a ${use.builtin.kind} holds no value that native code makes later`,
      );
      return;
  }
}

function cellOf(place: ModelPlace): ModelName[] {
  return place.place === "NativeCell" ? [place.cell] : [];
}

function cellsWrittenByOverloads(overloads: readonly ModelOverload[]): ModelName[] {
  return overloads.flatMap(({ flow }) => [
    ...flow.transfers.flatMap(({ to }) => cellOf(to)),
    ...flow.callbacks.flatMap(({ resultTo }) => cellOf(resultTo)),
  ]);
}

function collectWrittenCells(model: CheckedModel, written: readonly DescribedUses[]): Set<ModelName> {
  const cells = new Set([...cellsWrittenByOverloads(model.overloads), ...model.hostObjects.map(({ cell }) => cell)]);
  for (const { uses } of written) {
    forEachUse(uses, use => {
      if (use.read === "Kept") cells.add(use.cell);
    });
  }
  return cells;
}

function collectReadValues(model: CheckedModel, written: readonly DescribedUses[]): DescribedValue[] {
  const values: DescribedValue[] = [];
  for (const { row, uses } of written) {
    forEachUse(uses, use => {
      if (use.read !== "Called" || use.call === null) return;
      for (const value of valuesOfCall(use.call)) values.push({ row, value });
    });
  }
  for (const { cell, fields } of model.hostObjects) {
    for (const { name, value } of fields) {
      values.push({
        row: `${name === null ? "the other names" : `the field ${name.text}`} of the host object ${cell.text}`,
        value,
      });
    }
  }
  for (const { name, arguments: passed } of model.namedMemberCalls) {
    for (const value of passed) values.push({ row: `the call of a member named ${name.text}`, value });
  }
  for (const { name, cell } of model.hostMethodCalls) {
    values.push({ row: `a host method named ${name.text}`, value: { place: "NativeCell", cell } });
  }
  return values;
}

function checkCells(model: CheckedModel, written: readonly DescribedUses[], problems: Problems): void {
  const writtenCells = collectWrittenCells(model, written);
  for (const { row, value } of collectReadValues(model, written)) {
    if (value.place !== "NativeCell" || writtenCells.has(value.cell)) continue;
    problems.add(
      null,
      `${row}: nothing puts a value into the native cell ${value.cell.text}: no b.keptIn, no b.hostObject and no operand of an overload`,
    );
  }
}

function checkHostObjects({ hostObjects }: CheckedModel, problems: Problems): void {
  const cells = new Set<ModelName>();
  for (const { cell, function: described, internalFields, source } of hostObjects) {
    if (cells.has(cell)) problems.add(source, `two host objects lie in the native cell ${cell.text}`);
    cells.add(cell);
    if (
      described !== null &&
      !described.overloads.some(({ mode, flags }) => mode === "Call" && !flags.includes("IsUndeclared"))
    ) {
      problems.add(
        source,
        `the host object ${cell.text} is a function, and ${described.text} has no Call overload that says what a call does`,
      );
    }
    const indexes = new Set<number>();
    for (const { index } of internalFields) {
      if (!Number.isInteger(index) || index < 0 || index > maximumInternalFieldIndex) {
        problems.add(source, `the host object ${cell.text}: ${index} is no index of an internal field`);
      }
      if (indexes.has(index)) problems.add(source, `the host object ${cell.text} lists internal field ${index} twice`);
      indexes.add(index);
    }
  }
}

function checkNamedMemberCalls({ namedMemberCalls, overloads }: CheckedModel, problems: Problems): void {
  const calledNames = new Set(
    overloads.flatMap(({ receiver, parameters }) =>
      [...(receiver === null ? [] : [receiver]), ...parameters].flatMap(parameter => parameter.calledMembers),
    ),
  );
  const names = new Set<ModelName>();
  for (const { name, source } of namedMemberCalls) {
    if (names.has(name)) problems.add(source, `two rows say what native code passes to a member named ${name.text}`);
    names.add(name);
    if (!calledNames.has(name))
      problems.add(source, `no operand has b.calls("${name.text}"), so nothing calls a member of that name`);
  }
}

function checkHostMethodCalls({ hostMethodCalls, startup }: CheckedModel, problems: Problems): void {
  for (const { name, source } of hostMethodCalls) {
    if (startup.namesOfMethodsCallingLoads.includes(name)) continue;
    problems.add(
      source,
      `${name.text} is not among namesOfMethodsCallingLoads of b.startup, so nothing says that the host has methods of that name`,
    );
  }
}

const isIndex = (text: string): boolean => String(Number(text) >>> 0) === text;

// The list lets what a program stores under another name stay in the program. That takes one object of the realm that a program can store to, and a chain above it that the table knows.
export function checkNamesReadByNativeCode(
  { namesReadByNativeCode }: Pick<TableModel, "namesReadByNativeCode">,
  problems: Problems,
): void {
  for (const { holder, names, namesOnlyInspected } of namesReadByNativeCode) {
    const refuse = (reason: string) =>
      problems.add(null, `${holder.text} lists the names that native code reads, and ${reason}`);
    if (holder.scope !== "Realm") refuse("every module has an object of its own");
    if (holder.sameObjectAs !== null)
      refuse(`it is the same object as ${holder.sameObjectAs.text}, where the list belongs`);
    if (holder.flags.includes("IsGlobalObject")) refuse("native code finds every global variable on the global object");
    if (holder.flags.includes("IsLockedObject")) refuse("it is locked, so a program puts nothing there");
    if (holder.prototype.link === "Unknown") refuse("nothing says what lies above it, where a lookup goes on");
    names.forEach((name, position) => {
      if (position > 0 && names[position - 1] === name) refuse(`${name.text} is listed twice`);
      if (name.kind === "Text" && isIndex(name.text)) refuse(`${name.text} is an index`);
    });
    for (const name of namesOnlyInspected) {
      if (!names.includes(name)) refuse(`${name.text}, which it only inspects, is not among them`);
    }
  }
}

// What native code does with a value that it got hold of by itself. Every built-in and every native cell that a row names is there, and takes what the row gives it.
export function checkHostUses(model: CheckedModel, problems: Problems): void {
  const written = collectWrittenUses(model);
  for (const { row, uses } of written) forEachUse(uses, use => checkUse(row, use, problems));
  checkCells(model, written, problems);
  checkHostObjects(model, problems);
  checkNamedMemberCalls(model, problems);
  checkHostMethodCalls(model, problems);
}
