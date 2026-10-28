import { evaluate, within } from "./evaluate";
import { lines } from "./program";
import { attempt, isItem, readsOf, snapshot, write, type Outcome, type Plan } from "./table-driven";
import type { Operand, Parameter, Place, Table, TableType } from "./table";

export interface Doubt {
  row: string;
  overload: string;
  kind: string;
  text: string;
  call: string;
}

class Item {}

export const doubts: Doubt[] = [];
const seen = new Set<string>();

const protocolKeys: Record<string, string[]> = {
  ToPrimitive: ["@@toPrimitive", "valueOf", "toString", "@@toStringTag"],
  Thenable: ["then"],
  Iterate: ["@@iterator", "@@asyncIterator", "next", "return", "done", "value"],
  Species: ["constructor", "@@species"],
  ToJSON: ["toJSON"],
  HasInstance: ["@@hasInstance", "prototype"],
};
const convertsWithToPrimitive = (conversion: string) =>
  !["None", "ToBoolean", "ToObject", "Dictionary"].includes(conversion);
const writingUses = [
  "WritesContents",
  "MovesElements",
  "StoresByKey",
  "DeletesByKey",
  "AssignsFrom",
  "DefinesName",
  "TakesDescriptor",
  "ChangesIntegrity",
  "ChangesPrototype",
];

const keyName = (key: string | symbol) =>
  typeof key === "symbol" ? `@@${key.description!.replace("Symbol.", "")}` : key;
const tagOf = (value: unknown) => Object.prototype.toString.call(value).slice(8, -1).replaceAll(" ", "");

function isInstanceOf(token: string, value: unknown): boolean | null {
  if (token === "Function" || token === "BoundFunction") return typeof value === "function";
  if ((typeof value !== "object" || value === null) && typeof value !== "function") {
    const wrapper = { String: "string", Number: "number", Boolean: "boolean", BigInt: "bigint", Symbol: "symbol" }[
      token
    ];
    return wrapper === undefined ? false : typeof value === wrapper;
  }
  if (token === "TypedArray") return ArrayBuffer.isView(value) && !(value instanceof DataView);
  if (token === "Object") return true;
  const holder: Record<string, unknown> = token.startsWith("Intl") ? (Intl as never) : (globalThis as never);
  const constructor =
    holder[token.startsWith("Intl") ? token.slice(4) : token] ?? (Bun as unknown as Record<string, unknown>)[token];
  if (typeof constructor === "function") return value instanceof constructor;
  if (/Iterator$|^IteratorHelper$|Generator$/.test(token)) return tagOf(value) === token || null;
  return null;
}

interface Context {
  table: Table;
  operands: unknown[];
}

function valuesAt(operand: Operand | undefined, context: Context): unknown[] {
  if (operand === undefined) return [];
  if (operand === "this") return [context.operands[0]];
  if ("argument" in operand) return [context.operands[operand.argument + 1]];
  return context.operands.slice(operand.argumentsFrom + 1);
}

function contentsOf(value: object, slot: string): unknown[] | null {
  if (Array.isArray(value) && slot === "Element") return Array.from(value).filter((each, index) => index in value);
  if (value instanceof Set && slot === "Element") return [...value];
  if (value instanceof Map && slot === "Key") return [...value.keys()];
  if (value instanceof Map && slot === "Value") return [...value.values()];
  return null;
}

function admits(type: TableType, value: unknown, context: Context, depth = 3): boolean {
  if (type.isAnything) return true;
  const kind =
    value === null
      ? "Null"
      : {
          undefined: "Undefined",
          boolean: "Boolean",
          number: "Number",
          string: "String",
          symbol: "Symbol",
          bigint: "BigInt",
        }[typeof value as string];
  if (kind !== undefined && type.primitives.includes(kind)) {
    if (kind === "Number" && type.integers !== null) {
      const number = value as number;
      if (
        Number.isInteger(number) &&
        !Object.is(number, -0) &&
        number >= type.integers.minimum &&
        number <= type.integers.maximum
      )
        return true;
    } else if (kind === "String" && type.stringLiterals.length > 0) {
      if (type.stringLiterals.includes(value as string)) return true;
    } else return true;
  }
  if (kind === "String" && type.stringLiterals.includes(value as string)) return true;
  if (kind === "Number" && !type.primitives.includes("Number") && type.integers !== null) {
    const number = value as number;
    if (
      Number.isInteger(number) &&
      !Object.is(number, -0) &&
      number >= type.integers.minimum &&
      number <= type.integers.maximum
    )
      return true;
  }
  if (typeof value === "function" && (type.hasAnyFunction || type.hasAnyObject)) return true;
  if (typeof value === "object" && value !== null && (type.hasAnyObject || type.hasPlainData)) return true;
  for (const part of type.parts) {
    if (part.part === "Instance") {
      const answer = isInstanceOf(part.class!, value);
      if (answer === false) continue;
      if (answer === null || depth === 0 || typeof value !== "object" || value === null) return true;
      const slots = context.table.classes.find(each => each.token === part.class)?.slots ?? [];
      const isFilled = (part.contents ?? []).every(({ slot, type: held }) => {
        const contentsSlot = slots.find(each => each.token === slot || each.name === slot)?.contentsSlot;
        const contents = contentsSlot == null ? null : contentsOf(value, contentsSlot);
        return contents === null || contents.every(each => admits(held, each, context, depth - 1));
      });
      if (isFilled) return true;
    } else if (part.part === "Operand") {
      if (valuesAt(part.operand, context).some(each => Object.is(each, value))) return true;
    } else if (
      part.part === "Layout" ||
      part.part === "Builtin" ||
      part.part === "InstanceOfReceiverClass" ||
      part.part === "TypedArrayOfReceiverElementType"
    ) {
      if ((typeof value === "object" && value !== null) || typeof value === "function") return true;
    } else return true;
  }
  return false;
}

function shown(value: unknown): string {
  return Bun.inspect(value, { depth: 1 }).replace(/\s+/g, " ").slice(0, 80);
}

function holdsItem(value: unknown, depth = 3, visited = new Set<unknown>()): boolean {
  if (isItem(value)) return true;
  if (typeof value !== "object" || value === null || depth === 0 || visited.has(value)) return false;
  visited.add(value);
  if (value instanceof Map)
    return [...value].some(([key, each]) => holdsItem(key, depth - 1, visited) || holdsItem(each, depth - 1, visited));
  if (value instanceof Set) return [...value].some(each => holdsItem(each, depth - 1, visited));
  if (ArrayBuffer.isView(value)) return false;
  return Object.values(value).some(each => holdsItem(each, depth - 1, visited));
}

const carriesValues = (place: Place) => !["None", "NewValue"].includes(place.place);
const typeCarriesValues = (type: TableType): boolean =>
  type.isAnything ||
  type.parts.some(
    part =>
      !["Instance", "Layout", "Builtin"].includes(part.part) ||
      (part.contents ?? []).some(each => typeCarriesValues(each.type)),
  );

function sameOperand(left: Operand, index: number): boolean {
  if (left === "this") return index === 0;
  if ("argument" in left) return left.argument + 1 === index;
  return index >= left.argumentsFrom + 1;
}

function parameterAt(plan: Plan, index: number): Parameter | null {
  if (index === 0) return plan.overload.receiver;
  return (
    plan.overload.parameters[index - 1] ??
    plan.overload.parameters.findLast(parameter => parameter.mode === "Rest") ??
    null
  );
}

export async function auditPlan(plan: Plan, table: Table): Promise<void> {
  const written = write(plan);
  const outcome: Outcome | null = await attempt(plan, true);
  if (outcome === null) return;
  const { overload } = plan;
  const doubt = (kind: string, text: string) => {
    const key = `${overload.token} ${kind} ${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    doubts.push({
      row: plan.row.path,
      overload: overload.token,
      kind,
      text,
      call: lines(written.declarations, written.call).replace(/\s+/g, " "),
    });
  };
  const context: Context = { table, operands: outcome.operands.map((value, index) => value ?? undefined) };
  const inline = await evaluate(
    lines(
      plan.setup,
      `return [${[plan.receiver, ...plan.passed].map(candidate => (candidate === null || candidate.isFunction ? "undefined" : candidate.text)).join(", ")}];`,
    ),
  );
  if (!inline.failed) {
    (inline.value as unknown[]).forEach((value, index) => {
      if (context.operands[index] === undefined) context.operands[index] = value;
    });
  }

  for (const [index, candidate] of [plan.receiver, ...plan.passed].entries()) {
    const parameter = parameterAt(plan, index);
    if (candidate === null || candidate.isFunction) continue;
    if (parameter === null) {
      if (index === 0) continue;
      return;
    }
    if (!admits(parameter.accepted, context.operands[index], context, 0)) return;
  }
  const fits = (other: typeof overload) =>
    other.mode === overload.mode &&
    [plan.receiver, ...plan.passed].every((candidate, index) => {
      if (candidate === null) return true;
      const parameter =
        index === 0
          ? other.receiver
          : (other.parameters[index - 1] ?? other.parameters.findLast(each => each.mode === "Rest") ?? null);
      if (parameter === null) return index === 0;
      return candidate.isFunction
        ? parameter.accepted.isAnything || parameter.accepted.hasAnyFunction || parameter.accepted.hasAnyObject
        : admits(parameter.accepted, context.operands[index], context, 0);
    }) &&
    other.parameters.slice(plan.passed.length).every(parameter => parameter.mode !== "Required");
  if (plan.row.entry.overloads.find(fits) !== overload) return;
  if (
    !plan.shape.isOnPrototype &&
    overload.receiver !== null &&
    overload.result.type.parts.some(part => part.part === "Operand" && part.operand === "this")
  )
    return;

  if (overload.mode !== "Set" && !admits(overload.result.type, outcome.result, context)) {
    doubt("the answer is outside the type of the row", shown(outcome.result));
  }
  if (outcome.result instanceof Promise) {
    const pending = Symbol();
    const settled = await within<unknown>(
      outcome.result.catch(() => pending),
      pending,
      100,
    );
    const part = overload.result.type.parts.find(each => each.part === "Instance" && each.class === "Promise");
    const held = part?.contents?.find(each => /value/i.test(each.slot));
    if (settled !== pending && held !== undefined && !admits(held.type, settled, context)) {
      doubt("the promise settles with a value outside the type of the row", shown(settled));
    }
    if (
      settled !== pending &&
      holdsItem(settled) &&
      part !== undefined &&
      !typeCarriesValues(overload.result.type) &&
      !overload.transfers.some(each => each.to.place.startsWith("Result")) &&
      overload.model === null
    ) {
      doubt("the promise settles with a value of an operand, and no record carries it there", shown(settled));
    }
  }

  const carriesToResult =
    typeCarriesValues(overload.result.type) ||
    overload.transfers.some(each => each.to.place.startsWith("Result") && carriesValues(each.from)) ||
    overload.callbacks.some(each => each.resultTo.place.startsWith("Result")) ||
    overload.propertyActions.some(each => each.value.place.startsWith("Result")) ||
    overload.model !== null;
  if (overload.mode !== "Set" && holdsItem(outcome.result) && !carriesToResult) {
    const escapes = overload.transfers.some(each => each.to.place === "NativeMemory" && carriesValues(each.from));
    doubt(
      escapes
        ? "the answer holds a value of an operand, and the records carry it to native memory only"
        : "the answer holds a value of an operand, and no record carries it anywhere",
      shown(outcome.result),
    );
  }

  if (written.callbacks.length > 0 && overload.mode !== "Set") {
    const returned = new Item();
    const holdsReturned = (value: unknown, depth = 3): boolean =>
      value === returned ||
      (typeof value === "object" &&
        value !== null &&
        depth > 0 &&
        !ArrayBuffer.isView(value) &&
        (value instanceof Map || value instanceof Set ? [...value].flat() : Object.values(value)).some(each =>
          holdsReturned(each, depth - 1),
        ));
    const again = await attempt(plan, returned);
    let answer = again?.result;
    if (answer instanceof Promise)
      answer = await within<unknown>(
        answer.catch(() => undefined),
        undefined,
        100,
      );
    const isSaid =
      JSON.stringify(overload.result.type).includes("CallbackResult") ||
      overload.callbacks.some(
        each =>
          each.resultTo.place !== "None" ||
          each.resultUse === "Escapes" ||
          each.resultUse === "Returned" ||
          each.resultUse === "Stored",
      ) ||
      overload.result.type.isAnything ||
      overload.model !== null;
    if (holdsReturned(answer) && !isSaid)
      doubt(
        "the answer holds what a callback returned, and the record of the call says that its result goes nowhere",
        shown(answer),
      );
  }

  for (const [index, name] of written.names.entries()) {
    const parameter = parameterAt(plan, index);
    const value = outcome.operands[index];
    if (parameter === null || name === null || typeof value !== "object" || value === null) continue;
    if (snapshot(value) !== outcome.before[index] && !parameter.uses.some(use => writingUses.includes(use))) {
      doubt(
        `operand ${index} is changed, and the row has no use that writes it`,
        `${outcome.before[index].replace(/\s+/g, " ").slice(0, 60)} -> ${shown(value)}`,
      );
    }
  }

  written.callbacks.forEach((name, position) => {
    const index = written.names.indexOf(name);
    const records = outcome.records[position];
    if (records.length === 0) return;
    const declared = overload.callbacks.filter(each => sameOperand(each.callee, index));
    if (declared.length === 0)
      return doubt(`operand ${index} is called, and the row has no record of a call`, `${records.length} calls`);
    for (const record of records) {
      const fits = declared.some(each => {
        if (each.spreadArguments.place === "None" && record.passed.length > each.arguments.length) return false;
        if (each.thisValue.place === "None" && record.self !== undefined && !each.constructs) return false;
        return each.arguments.every(
          (place, at) =>
            place.place !== "NewValue" ||
            place.type === undefined ||
            at >= record.passed.length ||
            admits(place.type, record.passed[at], context),
        );
      });
      if (!fits) {
        doubt(
          `operand ${index} is called with this or arguments that no record of the row describes`,
          `this ${shown(record.self)}; ${record.passed.length} arguments: ${record.passed.map(shown).join(", ")}`.slice(
            0,
            160,
          ),
        );
        break;
      }
    }
    if (
      records.some(record => record.passed.some(each => holdsItem(each, 1))) &&
      !declared.some(each => each.arguments.some(carriesValues) || carriesValues(each.spreadArguments))
    ) {
      doubt(`operand ${index} is called with a value of an operand, and no argument of the record carries one`, "");
    }
  });

  for (const [index, candidate] of [plan.receiver, ...plan.passed].entries()) {
    const parameter = parameterAt(plan, index);
    if (candidate === null || candidate.isFunction || parameter === null) continue;
    if (index === 0 && (overload.mode !== "Call" || !plan.shape.isOnPrototype)) continue;
    if (!parameter.accepted.isAnything && !parameter.accepted.hasAnyObject) continue;
    const made = await evaluate(lines(plan.setup, `return [${candidate.text}];`));
    if (made.failed) continue;
    const value = (made.value as [unknown])[0];
    if (index > 0 && Array.isArray(value) && holdsItem(value)) {
      const records = JSON.stringify([overload.transfers, overload.result.type, overload.callbacks]);
      const replaced = write(plan, new Map([[index, "probe"]]));
      const settledOf = async (probe: unknown) => {
        const answer = await attempt(plan, true, ["probe"], [probe], replaced, false);
        if (answer === null) return { value: undefined, reason: undefined };
        if (!(answer.result instanceof Promise)) return { value: answer.result, reason: undefined };
        return within(
          answer.result.then(
            settled => ({ value: settled as unknown, reason: undefined as unknown }),
            reason => ({ value: undefined as unknown, reason: reason as unknown }),
          ),
          { value: undefined, reason: undefined },
          100,
        );
      };
      let isIterated = false;
      const iterable = {
        [Symbol.iterator]() {
          let position = 0;
          isIterated = true;
          return {
            next: () =>
              position < value.length ? { done: false, value: value[position++] } : { done: true, value: undefined },
          };
        },
      };
      const followsModel = overload.model !== null && overload.mode !== "Construct";
      if (
        holdsItem((await settledOf(iterable)).value) &&
        isIterated &&
        !records.includes("IteratedValues") &&
        !followsModel
      ) {
        doubt(
          `the answer holds a value that next() of operand ${index} returned, and no record speaks of iterated values`,
          "",
        );
      }
      const rejected = value.filter(isItem).map(each => Promise.reject(each));
      for (const each of rejected) each.catch(() => {});
      const promisePart = overload.result.type.parts.find(part => part.part === "Instance" && part.class === "Promise");
      if (rejected.length > 0 && promisePart !== undefined) {
        const reasonIsDescribed =
          (promisePart.contents ?? []).some(each => /reason/i.test(each.slot) && typeCarriesValues(each.type)) ||
          overload.transfers.some(each => each.to.place === "NativeMemory" || /reason/i.test(each.to.slot ?? ""));
        if (holdsItem((await settledOf(rejected)).reason, 4) && !reasonIsDescribed) {
          doubt(
            `the promise rejects with a value that holds the reason of an element of operand ${index}, and no record carries it`,
            "",
          );
        }
      }
    }
    if (typeof value === "symbol") continue;
    const isPrimitive = typeof value !== "object" || value === null;
    const isPlain = Array.isArray(value) || (!isPrimitive && Object.getPrototypeOf(value) === Object.prototype);
    if (!isPrimitive && !isPlain) continue;
    const base: object = isPrimitive ? { valueOf: () => value, toString: () => String(value) } : (value as object);
    const own = new Set(Reflect.ownKeys(base).map(keyName));
    const reads = await readsOf(plan, index, base);
    if (reads === null) continue;
    const allowed = new Set([...parameter.namedMembers, ...parameter.calledMembers, ...parameter.convertedMembers]);
    for (const protocol of parameter.protocols) for (const key of protocolKeys[protocol] ?? []) allowed.add(key);
    if (convertsWithToPrimitive(parameter.conversion)) for (const key of protocolKeys.ToPrimitive) allowed.add(key);
    const readsOwn =
      parameter.protocols.includes("OwnValues") ||
      parameter.uses.includes("ReadsContents") ||
      parameter.uses.includes("AssignsFrom") ||
      parameter.uses.includes("RetainsContents");
    const unnamed = [...new Set(reads.map(keyName))].filter(
      key => !allowed.has(key) && !(readsOwn && !isPrimitive && own.has(key)),
    );
    if (unnamed.length > 0)
      doubt(`operand ${index} is read under names that no record of the row has`, unnamed.join(" "));
  }
}

const saidOf = (parameter: Parameter) =>
  new Set([
    ...parameter.protocols.filter(protocol => protocol !== "Named" && protocol !== "CallsNamed"),
    ...parameter.namedMembers,
    ...parameter.calledMembers,
  ]);

export function auditTable(table: Table): void {
  const methods = new Map<string, Table["entries"]>();
  for (const entry of table.entries) {
    if (entry.kind === "Method" && entry.origin === "Engine")
      methods.set(entry.name, [...(methods.get(entry.name) ?? []), entry]);
  }
  for (const entry of table.entries) {
    for (const overload of entry.overloads) {
      if (overload.isUndeclared) continue;
      const doubt = (kind: string, text: string) =>
        doubts.push({ row: entry.path, overload: overload.token, kind, text, call: "" });
      for (const callback of overload.callbacks) {
        if (callback.arguments.some(place => typeof place.operand === "object" && "argumentsFrom" in place.operand)) {
          doubt("a rest operand stands as one argument of a call that the row records", "");
        }
      }
      for (const parameter of [overload.receiver, ...overload.parameters]) {
        if (parameter === null) continue;
        const said = saidOf(parameter);
        for (const member of parameter.calledMembers) {
          for (const callee of methods.get(member.replace(/^@@/, "")) ?? []) {
            const missing = new Set<string>();
            for (const other of callee.overloads) {
              if (other.receiver !== null)
                for (const each of saidOf(other.receiver)) if (!said.has(each)) missing.add(each);
            }
            if (missing.size > 0) {
              doubt(
                "the row calls a member that may be an inherited built-in whose own row says more about its receiver",
                `${member} = ${callee.path}: ${[...missing].join(" ")}`,
              );
            }
          }
        }
      }
    }
  }
}
