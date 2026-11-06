// A row of the table of built-ins that calls its result fresh says: this call makes a new object, its prototype is the one of the class that the row names, and it holds the names that the
// row and the class list and no others. The compiler takes a read of any other name on it for `undefined`. Here each such row is called and what it made is held against the row:
// the own keys (symbols too), the prototype, and the same for what the result holds in its slots, fields and properties.
//
//   bun --expose-internals fresh-results.ts <aot_builtin_table.json> [pattern of paths]      the last line that it prints is `Found` below, as JSON
import { bodyOf, within } from "./evaluate";
import { calls, families, familiesNotCalled, linkedByLibraryCode, notCalled } from "./fresh-results-calls";
import { readTable, type Entry, type Overload, type Row, type TableType, type TypePart } from "./table";
import { attempt, matches, neverEvaluated, plansOf, write } from "./table-driven";

interface DumpedClass {
  token: string;
  parent: string | null;
  constructor: string | null;
  prototype: string | null;
  definesCharactersOnNewInstances: boolean;
  namesDefinedOnNewInstances: string[] | null;
  slots: { token: string; heap: string | null }[];
}
interface DumpedEntry extends Entry {
  token: string;
  flags: string[];
  platforms: string[];
  isSymbolName: boolean;
  prototypeLink: string;
  inheritsFrom: string | null;
}
interface DumpedLayout {
  token: string;
  isTuple: boolean;
  fields: { name: string; isOptional: boolean; type: TableType }[];
}
interface DumpedResult {
  type: TableType;
  prototypeSource: unknown;
  properties: { name: string; type: TableType }[];
}

const isObject = (value: unknown): value is object =>
  (typeof value === "object" && value !== null) || typeof value === "function";
const isIndex = (key: string | symbol) => typeof key === "string" && /^(0|[1-9][0-9]*)$/.test(key);
const nameOfKey = (key: string | symbol) =>
  typeof key === "symbol" ? `@@${(key.description ?? "").replace(/^Symbol\./, "")}` : key;
const madeParts = ["Instance", "Layout", "InstanceOfReceiverClass", "TypedArrayOfReceiverElementType"];

const AsyncFunction = async function () {}.constructor as new (
  ...text: string[]
) => (load: unknown) => Promise<unknown>;

/** The value of the last line of `text`, in a list: a promise stays a promise. */
async function valueOf(text: string): Promise<{ value: unknown } | { error: unknown }> {
  const statements = text.split("\n");
  const body = bodyOf([...statements.slice(0, -1), `return [${statements.at(-1)}];`].join("\n"));
  const late = Symbol();
  try {
    const made = await within<unknown>(
      new AsyncFunction("load", body)((name: string) => require(name)),
      late,
      10000,
    );
    if (made === late) return { error: new Error("it does not finish") };
    const [value] = made as [unknown];
    if (value instanceof Promise) value.catch(() => {});
    return { value };
  } catch (error) {
    return { error };
  }
}

export class Judge {
  classes: Map<string, DumpedClass>;
  entries: Map<string, DumpedEntry>;
  layouts: Map<string, DumpedLayout>;
  members = new Map<string, DumpedEntry[]>();
  below = new Map<string, string[]>();
  /** For each class of which an instance was seen: the own keys that are neither members of every instance nor elements. */
  ownKeysSeen = new Map<string, Set<string>>();

  constructor(table: { entries: Entry[]; classes: unknown[]; layouts?: unknown[] }) {
    this.classes = new Map((table.classes as DumpedClass[]).map(each => [each.token, each]));
    this.entries = new Map((table.entries as DumpedEntry[]).map(each => [each.token, each]));
    this.layouts = new Map(((table.layouts ?? []) as DumpedLayout[]).map(each => [each.token, each]));
    for (const entry of this.entries.values()) {
      if (entry.holder === null) continue;
      if (!this.members.has(entry.holder)) this.members.set(entry.holder, []);
      this.members.get(entry.holder)!.push(entry);
    }
    for (const each of this.classes.values()) {
      for (let above = each.parent; above !== null; above = this.classes.get(above)?.parent ?? null) {
        if (!this.below.has(above)) this.below.set(above, []);
        this.below.get(above)!.push(each.token);
      }
    }
  }

  reach(path: string): unknown {
    const module = /^((?:node|bun):[^.]+)(?:\.(.*))?$/.exec(path);
    let value: unknown = module === null ? globalThis : require(module[1]);
    const rest = module === null ? path : (module[2] ?? "");
    for (const part of rest.match(/[^.[\]]+|\[Symbol\.[A-Za-z]+\]/g) ?? []) {
      if (part.startsWith("%") || !isObject(value)) return undefined;
      const symbol = /^\[Symbol\.([A-Za-z]+)\]$/.exec(part);
      value = (value as Record<PropertyKey, unknown>)[
        symbol === null ? part : (Symbol as unknown as Record<string, symbol>)[symbol[1]]
      ];
    }
    return value;
  }

  private memberNames(token: string): Set<string> {
    return new Set((this.members.get(token) ?? []).map(each => (each.isSymbolName ? `@@${each.name}` : each.name)));
  }

  /** Whether a name that no object from `token` upwards lists is taken for absent. */
  private isClosed(token: string | null): boolean {
    for (let current = token; current !== null; ) {
      const entry = this.entries.get(current);
      if (entry === undefined || !entry.flags.includes("ListsAllMembers")) return false;
      if (entry.prototypeLink === "Null") return true;
      if (entry.prototypeLink !== "Builtin") return false;
      current = entry.inheritsFrom;
    }
    return true;
  }

  /** What is wrong with `actual` standing for the object of the table `token`, and with the objects above it. */
  private chainProblems(actual: object | null, token: string | null): string[] {
    const problems: string[] = [];
    for (let current = token; ; ) {
      if (current === null) {
        if (actual !== null) problems.push("the chain goes on where the one of the table ends");
        return problems;
      }
      const entry = this.entries.get(current)!;
      if (actual === null) return [...problems, `the chain ends where the table has ${entry.path}`];
      const reached = this.reach(entry.path);
      if (isObject(reached) && reached !== actual) return [...problems, `the prototype is not ${entry.path}`];
      if (entry.flags.includes("ListsAllMembers")) {
        const listed = this.memberNames(current);
        const others = Reflect.ownKeys(actual)
          .map(nameOfKey)
          .filter(name => !listed.has(name));
        if (others.length > 0) problems.push(`${entry.path} holds ${others.join(" ")}`);
      }
      if (entry.prototypeLink === "Unknown" || entry.path in linkedByLibraryCode) return problems;
      actual = Object.getPrototypeOf(actual);
      current = entry.prototypeLink === "Null" ? null : entry.inheritsFrom;
    }
  }

  private namesOnInstances(token: string, withNamesDefined = true): Set<string> {
    const names = new Set<string>();
    for (let current = this.classes.get(token); current; current = this.classes.get(current.parent ?? "")) {
      for (const name of (withNamesDefined && current.namesDefinedOnNewInstances) || []) names.add(name);
      for (const member of this.members.get(current.prototype ?? "") ?? [])
        if (member.flags.includes("IsOwnPropertyOfInstances")) names.add(member.name);
    }
    return names;
  }

  private noteOwnKeys(token: string, keys: (string | symbol)[], listedByRow: Set<string>) {
    if (!this.ownKeysSeen.has(token)) this.ownKeysSeen.set(token, new Set());
    const always = this.namesOnInstances(token, false);
    for (const key of keys)
      if (!(isIndex(key) && this.hasElements(token)) && !always.has(nameOfKey(key)) && !listedByRow.has(nameOfKey(key)))
        this.ownKeysSeen.get(token)!.add(isIndex(key) ? "an index" : nameOfKey(key));
  }

  private hasElements(token: string): boolean {
    for (let current = this.classes.get(token); current; current = this.classes.get(current.parent ?? "")) {
      if (current.definesCharactersOnNewInstances || current.slots.some(slot => slot.heap === "Elements")) return true;
      if (current.token === "TypedArray" || current.token === "Arguments") return true;
    }
    return false;
  }

  private constructorListsOwnNames(token: string): boolean {
    const constructor = this.entries.get(this.classes.get(token)?.constructor ?? "");
    const rows = (constructor?.overloads ?? []).filter(row => row.mode === "Construct");
    return rows.length > 0 && rows.every(row => !row.isUndeclared && row.result.type.freshness !== "Unaliased");
  }

  private everyClassAboveListsNames(token: string): boolean {
    for (let current = this.classes.get(token); current; current = this.classes.get(current.parent ?? ""))
      if (current.namesDefinedOnNewInstances === null) return false;
    return true;
  }

  private isFunctionClass(token: string): boolean {
    for (let current = this.classes.get(token); current; current = this.classes.get(current.parent ?? ""))
      if (current.token === "Function") return true;
    return false;
  }

  private async held(value: object, slot: string): Promise<unknown[] | null> {
    switch (slot) {
      case "ArrayElement":
        return Array.isArray(value) ? value.slice(0, 8) : null;
      case "PromiseValue": {
        if (!(value instanceof Promise)) return null;
        const late = Symbol();
        const settled = await within<unknown>(
          value.catch(() => late),
          late,
          2000,
        );
        return settled === late ? [] : [settled];
      }
      case "PromiseReason": {
        if (!(value instanceof Promise)) return null;
        const late = Symbol();
        const settled = await within<unknown>(
          value.then(
            () => late,
            reason => reason,
          ),
          late,
          2000,
        );
        return settled === late ? [] : [settled];
      }
      case "MapKey":
        return value instanceof Map ? [...value.keys()].slice(0, 8) : null;
      case "MapValue":
        return value instanceof Map ? [...value.values()].slice(0, 8) : null;
      case "SetElement":
        return value instanceof Set ? [...value].slice(0, 8) : null;
      default:
        return null;
    }
  }

  private async partProblems(
    value: object,
    part: TypePart & { isOfClassItself?: boolean },
    freshness: string,
    row: Overload | null,
    receiver: unknown,
    where: string,
  ): Promise<string[]> {
    const problems: string[] = [];
    const result = row?.result as DumpedResult | undefined;
    const keys = Reflect.ownKeys(value);
    if (part.part === "Layout") {
      const layout = this.layouts.get(part.layout!)!;
      const prototype = layout.isTuple ? Array.prototype : Object.prototype;
      if (Object.getPrototypeOf(value) !== prototype)
        problems.push(`${where}: the prototype is not ${layout.isTuple ? "Array" : "Object"}.prototype`);
      const listed = new Set(layout.isTuple ? ["length"] : layout.fields.map(field => field.name));
      const others = keys.filter(key => !(layout.isTuple && isIndex(key)) && !listed.has(nameOfKey(key)));
      if (others.length > 0) problems.push(`${where}: holds ${others.map(nameOfKey).join(" ")}`);
      for (const [index, field] of layout.fields.entries()) {
        const key = layout.isTuple ? String(index) : field.name;
        if (field.isOptional && !Object.hasOwn(value, key)) continue;
        problems.push(
          ...(await this.problems(
            (value as Record<string, unknown>)[key],
            field.type,
            null,
            receiver,
            `${where}.${key}`,
          )),
        );
      }
      return problems;
    }
    if (part.part !== "Instance") {
      if (isObject(receiver) && Object.getPrototypeOf(value) !== Object.getPrototypeOf(receiver))
        problems.push(`${where}: the prototype is not the one of the receiver`);
      const others = keys.filter(key => !isIndex(key) && key !== "length");
      if (others.length > 0) problems.push(`${where}: holds ${others.map(nameOfKey).join(" ")}`);
      return problems;
    }

    const token = part.class!;
    const builtinClass = this.classes.get(token)!;
    if (token !== "BoundFunction" && this.isFunctionClass(token)) return [];
    const describesItself =
      row !== null &&
      (result!.properties.length > 0 || row.propertyActions.some(action => action.action === "DescribesResult"));
    const saysNothingOfNames =
      freshness === "Unaliased" &&
      !describesItself &&
      (this.constructorListsOwnNames(token) || !this.everyClassAboveListsNames(token));
    const takesPrototypeFromOperand =
      row !== null &&
      (result!.prototypeSource !== null ||
        row.propertyActions.some(action => action.action === "BecomesPrototype" && action.value.place === "Result"));
    if (builtinClass.prototype === null)
      this.noteOwnKeys(token, keys, new Set((result?.properties ?? []).map(own => own.name)));
    if (!saysNothingOfNames && builtinClass.prototype !== null) {
      const candidates = [token, ...(part.isOfClassItself ? [] : (this.below.get(token) ?? []))]
        .map(each => this.classes.get(each)!.prototype)
        .filter(each => each !== null);
      let chain: string[] | null = null;
      let closed = false;
      if (takesPrototypeFromOperand) chain = [];
      // A row may list, as properties of its result, what an object of its own in front of the prototype of the class holds.
      let first = Object.getPrototypeOf(value);
      const listedByRow = new Set((result?.properties ?? []).map(own => own.name));
      if (
        first !== null &&
        listedByRow.size > 0 &&
        Reflect.ownKeys(first).every(key => listedByRow.has(nameOfKey(key)))
      )
        first = Object.getPrototypeOf(first);
      for (const candidate of takesPrototypeFromOperand ? [] : candidates) {
        const found = this.chainProblems(first, candidate);
        if (chain === null || found.length < chain.length) {
          chain = found;
          closed = this.isClosed(candidate);
        }
        if (found.length === 0) {
          this.noteOwnKeys(
            [...this.classes.values()].find(each => each.prototype === candidate)!.token,
            keys,
            listedByRow,
          );
          break;
        }
      }
      problems.push(...(chain ?? []).map(each => `${where}: ${each}`));
      const listed = this.namesOnInstances(token);
      for (const own of result?.properties ?? []) listed.add(own.name);
      const others = keys.filter(key => !(isIndex(key) && this.hasElements(token)) && !listed.has(nameOfKey(key)));
      const takesNamesFromOperand =
        row !== null && row.propertyActions.some(action => action.action === "DescribesResult");
      if (others.length > 0 && !takesNamesFromOperand)
        problems.push(
          `${where}: ${closed || takesPrototypeFromOperand ? "" : "(a name that is missed is looked for in a prototype that does not list all it has) "}holds ${others.map(nameOfKey).join(" ")}`,
        );
    }
    for (const contents of part.contents ?? []) {
      for (const each of (await this.held(value, contents.slot)) ?? [])
        problems.push(...(await this.problems(each, contents.type, null, receiver, `${where}<${contents.slot}>`)));
    }
    // A read of a property that a row lists may still find nothing.
    for (const own of result?.properties ?? [])
      if (own.name in value)
        problems.push(
          ...(await this.problems(
            (value as Record<string, unknown>)[own.name],
            own.type,
            null,
            receiver,
            `${where}.${own.name}`,
          )),
        );
    return problems;
  }

  private isPlainData(value: unknown, depth = 0): boolean {
    if (!isObject(value)) return true;
    if (depth > 6) return true;
    const prototype = Object.getPrototypeOf(value);
    if (Array.isArray(value) ? prototype !== Array.prototype : prototype !== Object.prototype) return false;
    return Reflect.ownKeys(value).every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      return "value" in descriptor && this.isPlainData(descriptor.value, depth + 1);
    });
  }

  /** What is wrong with `value` where the table says `type`. `row` is given for the result of a call itself. */
  async problems(
    value: unknown,
    type: TableType,
    row: Overload | null,
    receiver: unknown,
    where: string,
  ): Promise<string[]> {
    if (type.isAnything) return [];
    if (!isObject(value)) {
      const kind =
        value === null
          ? "Null"
          : {
              undefined: "Undefined",
              boolean: "Boolean",
              number: "Number",
              string: "String",
              bigint: "BigInt",
              symbol: "Symbol",
            }[typeof value as string]!;
      if (type.primitives.includes(kind)) return [];
      if (kind === "String" && type.stringLiterals.includes(value as string)) return [];
      if (type.parts.some(part => !madeParts.includes(part.part)) || type.hasPlainData) return [];
      return [`${where}: is ${kind === "String" ? JSON.stringify(value) : String(value)}`];
    }
    const listsWhatIsMadeWithoutSpecies =
      type.freshness === "UnlessSpecies" && type.parts.some(part => part.part === "Instance");
    if ((type.hasAnyObject || type.hasAnyFunction) && !listsWhatIsMadeWithoutSpecies) return [];
    if (type.hasPlainData && this.isPlainData(value)) return [];
    const made = type.parts.filter(part => madeParts.includes(part.part));
    if (type.freshness === "No" && made.length > 0) return [];
    let fewest: string[] | null = null;
    for (const part of made) {
      const found = await this.partProblems(value, part, type.freshness, row, receiver, where);
      if (fewest === null || found.length < fewest.length) fewest = found;
      if (found.length === 0) return [];
    }
    if (type.parts.length > made.length) return [];
    return fewest ?? [`${where}: is ${type.hasPlainData ? "no plain data" : "an object"}`];
  }
}

/** Whether the compiler takes what the type says for all there is to know of an object of it. Of plain data it knows the prototypes, and that it holds nothing but plain data. */
function saysFresh(type: TableType): boolean {
  if (type.freshness !== "No" && type.parts.some(part => madeParts.includes(part.part))) return true;
  return type.hasPlainData && !type.isAnything && !type.hasAnyObject && !type.hasAnyFunction;
}

/** What a row says native code makes and hands to a callback or keeps for a later call, by the classes it names. */
function newValuesOf(entry: Entry): Map<string, TableType> {
  const types = new Map<string, TableType>();
  const walk = (value: unknown) => {
    if (typeof value !== "object" || value === null) return;
    const place = value as { place?: string; type?: TableType };
    if (place.place === "NewValue" && place.type !== undefined && saysFresh(place.type))
      types.set(place.type.parts.map(part => part.class ?? part.layout ?? part.part).join(" "), place.type);
    for (const each of Object.values(value)) walk(each);
  };
  for (const { transfers, callbacks, propertyActions, handlerCalls } of entry.overloads)
    walk([transfers, callbacks, propertyActions, handlerCalls]);
  return types;
}

export interface Found {
  judged: string[];
  notCalled: string[];
  wrong: string[];
  /** `ownKeysSeen` of the judge. */
  ownKeysSeen: Record<string, string[]>;
}

export async function judgeFreshRows(tablePath: string, only: RegExp | null = null): Promise<Found> {
  const table = readTable(tablePath);
  const judge = new Judge(table as never);
  const found: Found = { judged: [], notCalled: [], wrong: [], ownKeysSeen: {} };
  const platform = { linux: "Linux", darwin: "Darwin", win32: "Windows", freebsd: "FreeBSD", android: "Android" }[
    process.platform as string
  ];
  const elsewhere = new Set<string>();
  for (const entry of table.entries as DumpedEntry[]) {
    if (only !== null && !only.test(entry.path)) continue;
    if (platform !== undefined && !entry.platforms.includes(platform)) {
      elsewhere.add(entry.path);
      continue;
    }
    for (const [classes, type] of newValuesOf(entry)) {
      const key = `${entry.path} > ${classes}`;
      if (key in notCalled) {
        found.notCalled.push(key);
        continue;
      }
      if (calls[key] === undefined)
        found.wrong.push(`${key}: neither called nor listed among the rows that are not called`);
      for (const text of calls[key] ?? []) {
        const evaluation = await valueOf(text);
        if ("error" in evaluation) {
          found.wrong.push(`${key}: ${text.split("\n").at(-1)}: ${String(evaluation.error).slice(0, 160)}`);
          continue;
        }
        found.judged.push(key);
        for (const problem of await judge.problems(evaluation.value, type, null, undefined, "value"))
          found.wrong.push(`${key}: ${text.split("\n").at(-1)}: ${problem}`);
      }
    }
    const rows = entry.overloads.filter(row => row.mode !== "Set" && saysFresh(row.result.type));
    if (rows.length === 0) continue;
    // One native function has a row under the file that defines it and one under the name by which compiled code calls it.
    const twin =
      entry.holder === "NativeFunctions"
        ? (table.entries as DumpedEntry[]).find(
            other =>
              other.path.startsWith("native:") &&
              other.token.replace(/^Native(Bindgen|NewCppFunction|Cpp)/, "") ===
                entry.token.replace(/^NativeFunctions/, ""),
          )
        : undefined;
    let written = calls[entry.path] ?? calls[twin?.path ?? ""];
    const family = families.find(each => each.rows.test(entry.path));
    if (written === undefined && family !== undefined) {
      // The first operands that the function takes.
      const callee = family.callee(entry.path, rows[0].mode);
      for (const operands of callee === null ? [] : family.operands) {
        const text = rows[0].mode === "Get" ? callee! : `${callee}(${operands})`;
        if ("error" in (await valueOf(text))) continue;
        written = [text];
        break;
      }
    }
    if (written !== undefined) {
      for (const text of written) {
        const evaluation = await valueOf(text);
        if ("error" in evaluation) {
          found.wrong.push(`${entry.path}: ${text.split("\n").at(-1)}: ${String(evaluation.error).slice(0, 160)}`);
          continue;
        }
        let fewest: string[] | null = null;
        for (const row of rows) {
          const problems = await judge.problems(evaluation.value, row.result.type, row, undefined, "result");
          if (fewest === null || problems.length < fewest.length) fewest = problems;
        }
        found.judged.push(entry.path);
        const last = text.split("\n").at(-1)!;
        if (!/^[A-Za-z]+$/.test(last) && isObject(evaluation.value)) {
          const twice = await valueOf([...text.split("\n").slice(0, -1), `[${last}, ${last}]`].join("\n"));
          if ("value" in twice) {
            const [first, second] = twice.value as [unknown, unknown];
            for (const each of [first, second]) if (each instanceof Promise) each.catch(() => {});
            if (first === second) found.wrong.push(`${entry.path}: ${last}: answers the same object twice`);
          }
        }
        for (const problem of fewest ?? []) found.wrong.push(`${entry.path}: ${text.split("\n").at(-1)}: ${problem}`);
      }
      continue;
    }
    if (
      entry.path in notCalled ||
      (twin?.path ?? "") in notCalled ||
      familiesNotCalled.some(each => each.rows.test(entry.path))
    ) {
      found.notCalled.push(entry.path);
      continue;
    }
    if (matches(neverEvaluated, entry.path)) {
      found.wrong.push(`${entry.path}: neither called nor listed among the rows that are not called`);
      continue;
    }
    const asRow: Row = { path: entry.path, origin: entry.origin, overloads: rows.length, entry, trusted: rows };
    let called = 0;
    for (const row of rows) {
      for (const plan of await plansOf(asRow, row, "mixed")) {
        const outcome = await attempt(plan, true);
        if (outcome === null) continue;
        called++;
        const text = write(plan);
        const problems = await judge.problems(outcome.result, row.result.type, row, outcome.operands[0], "result");
        if (isObject(outcome.result) && !row.result.type.parts.some(part => !madeParts.includes(part.part))) {
          const once = write(plan);
          const twice = await attempt(plan, true, [], [], { ...once, call: `[${once.call}, ${once.call}]` });
          const [first, second] = (twice?.result ?? [1, 2]) as [unknown, unknown];
          for (const each of [first, second]) if (each instanceof Promise) each.catch(() => {});
          if (first === second) problems.push("answers the same object twice");
        }
        if (problems.length === 0) continue;
        // The operands are drawn from the types of one row, and another row of the entry may be the one that takes them.
        let isExplained = false;
        for (const other of entry.overloads) {
          if (other === row || other.mode !== row.mode) continue;
          if (
            (await judge.problems(outcome.result, other.result.type, other, outcome.operands[0], "result")).length === 0
          )
            isExplained = true;
        }
        if (!isExplained) for (const problem of problems) found.wrong.push(`${row.token}: ${text.call}: ${problem}`);
      }
    }
    if (called > 0) found.judged.push(entry.path);
    else found.wrong.push(`${entry.path}: neither called nor listed among the rows that are not called`);
  }
  for (const key of [...Object.keys(calls), ...Object.keys(notCalled)])
    if (
      only === null &&
      !elsewhere.has(key.split(" > ")[0]) &&
      !found.judged.includes(key) &&
      !found.notCalled.includes(key) &&
      !found.wrong.some(line => line.startsWith(key))
    )
      found.wrong.push(`${key}: the table has no such row that makes a new object`);
  for (const [token, keys] of judge.ownKeysSeen) found.ownKeysSeen[token] = [...keys].sort();
  return found;
}

if (import.meta.main) {
  const found = await judgeFreshRows(
    process.argv[2],
    process.argv[3] === undefined ? null : new RegExp(process.argv[3]),
  );
  console.log(`\n${JSON.stringify(found)}`);
  process.exit(0);
}
