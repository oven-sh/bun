import * as internals from "bun:internal-for-testing";
import { jscDescribe } from "bun:jsc";
import { readdirSync } from "node:fs";
import { isBuiltin } from "node:module";
import { join } from "node:path";
import { types } from "node:util";
import { isObject, type CallMode, type DumpedEntry, type DumpedType, type Table } from "./table-description";

export type Member = { holder: object | undefined; key: PropertyKey; descriptor: PropertyDescriptor | undefined };
export type Invocation = {
  mode: CallMode;
  callee: Function | undefined;
  key: PropertyKey;
  callsWhatIsRead: boolean;
};

const prototypeOf = (value: unknown): object => Reflect.getPrototypeOf(Object(value))!;
const modulesInPlaceOfPackages = ["utf-8-validate"];

const preludeFolder = join(import.meta.dir, "../../../../src/aot/prelude");

// The helpers that are written in TypeScript and compiled with a program. Here they run as they are written.
function loadCompiledHelpers(): object {
  const helpers: Record<string, unknown> = {};
  // Each file says by stores to this name which of its functions a stack trace shows.
  Reflect.set(globalThis, "$visibility", "");
  try {
    for (const file of readdirSync(preludeFolder)) {
      if (file.endsWith(".ts") && !file.endsWith(".d.ts")) Object.assign(helpers, require(join(preludeFolder, file)));
    }
  } finally {
    Reflect.deleteProperty(globalThis, "$visibility");
  }
  return helpers;
}

function createHiddenRoots(): Map<string, () => unknown> {
  const generatorFunction = prototypeOf(function* () {});
  const asyncGeneratorFunction = prototypeOf(async function* () {});
  const asyncGeneratorPrototype = () => Reflect.get(asyncGeneratorFunction, "prototype");
  return new Map<string, () => unknown>([
    ["%TypedArray%", () => prototypeOf(Int8Array)],
    ["%ArrayIterator%.prototype", () => prototypeOf([].values())],
    ["%MapIterator%.prototype", () => prototypeOf(new Map().values())],
    ["%SetIterator%.prototype", () => prototypeOf(new Set().values())],
    ["%StringIterator%.prototype", () => prototypeOf(""[Symbol.iterator]())],
    ["%RegExpStringIterator%.prototype", () => prototypeOf("".matchAll(/a/g))],
    ["%IteratorHelper%.prototype", () => prototypeOf([].values().map(value => value))],
    ["%WrapForValidIterator%.prototype", () => prototypeOf(Iterator.from({ next: () => ({ done: true, value: 0 }) }))],
    ["%GeneratorFunction%", () => Reflect.get(generatorFunction, "constructor")],
    ["%Generator%.prototype", () => Reflect.get(generatorFunction, "prototype")],
    ["%AsyncGeneratorFunction%", () => Reflect.get(asyncGeneratorFunction, "constructor")],
    ["%AsyncGenerator%.prototype", asyncGeneratorPrototype],
    ["%AsyncIterator%.prototype", () => prototypeOf(asyncGeneratorPrototype())],
    ["%AsyncFunction%", () => Reflect.get(prototypeOf(async function () {}), "constructor")],
    ["%IntlSegments%.prototype", () => prototypeOf(new Intl.Segmenter().segment(""))],
    ["%IntlSegmentIterator%.prototype", () => prototypeOf(new Intl.Segmenter().segment("")[Symbol.iterator]())],
    ["%HeadersIterator%.prototype", () => prototypeOf(new Headers().entries())],
    ["%URLSearchParamsIterator%.prototype", () => prototypeOf(new URLSearchParams().entries())],
    ["%ImportMeta%", () => import.meta],
    ["%ModuleObject%", () => require("./module-object.cjs")],
    ["%CompilerHelpers%", loadCompiledHelpers],
    ["%ModuleRequire%", () => require],
  ]);
}

export class Realm {
  readonly table: Table;
  #hiddenRoots = createHiddenRoots();
  #values = new Map<string, unknown>();
  #classesByPrototype: Map<object, string> | undefined;
  #knownObjects: Set<object> | undefined;
  #idsInThisBuild: Map<string, number> | undefined;
  #nativeNames: Map<string, string> | undefined;

  constructor(table: Table) {
    this.table = table;
  }

  register(path: string, value: unknown): void {
    this.#hiddenRoots.set(path, () => value);
    this.#values.clear();
    this.#classesByPrototype = undefined;
    this.#knownObjects = undefined;
  }

  #rootOf(entry: DumpedEntry): unknown {
    if (entry.token === "GlobalThis") return globalThis;
    const hidden = this.#hiddenRoots.get(entry.path);
    if (hidden) return hidden();
    if (entry.scope === "Module") return this.#findInAnswersOfBindings(entry.token);
    // A package that Bun answers for by itself where none is installed.
    return entry.path.startsWith("%") || !(isBuiltin(entry.path) || modulesInPlaceOfPackages.includes(entry.path)) ? undefined : require(entry.path);
  }

  // The native binding that answers the object, by itself or as a field of what it answers.
  bindingAnswering(token: string): { binding: DumpedEntry; field: PropertyKey | undefined } | undefined {
    const names = ({ parts }: DumpedType) => parts.some(part => part.part === "Builtin" && part.builtin === token);
    for (const binding of this.table.dump.entries) {
      const answer = binding.kind === "NativeBinding" ? binding.overloads.find(({ mode }) => mode === "Get")?.result.type : undefined;
      if (answer === undefined) continue;
      if (names(answer)) return { binding, field: undefined };
      for (const part of answer.parts) {
        const layout = part.part === "Layout" ? this.table.layouts.get(part.layout) : undefined;
        const index = layout?.fields.findIndex(field => names(field.type)) ?? -1;
        if (index >= 0) return { binding, field: layout!.fields[index].name ?? index };
      }
    }
    return undefined;
  }

  #findInAnswersOfBindings(token: string): unknown {
    const found = this.bindingAnswering(token);
    const answer = found && this.valueOf(found.binding.token);
    if (found?.field === undefined) return answer;
    return isObject(answer) ? Reflect.get(answer, found.field) : undefined;
  }

  keyOf(entry: DumpedEntry): PropertyKey {
    if (!entry.isSymbolName) return entry.name;
    return (Reflect.get(Symbol, entry.name) as symbol | undefined) ?? Symbol.for(entry.name);
  }

  memberOf(entry: DumpedEntry): Member | undefined {
    if (entry.holder === null) return undefined;
    const holder = this.valueOf(entry.holder);
    if (!isObject(holder)) return undefined;
    const key = this.keyOf(entry);
    // The table lists some members of a prototype without a name under the one object that inherits them.
    let owner: object | null = holder;
    while (owner !== null && !types.isProxy(owner) && !Object.hasOwn(owner, key)) owner = Reflect.getPrototypeOf(owner);
    return { holder, key, descriptor: owner === null ? undefined : Reflect.getOwnPropertyDescriptor(owner, key) };
  }

  valueOf(token: string | null): unknown {
    if (token === null) return undefined;
    if (this.#values.has(token)) return this.#values.get(token);
    const entry = this.table.entries.get(token);
    let value: unknown;
    try {
      const registered = entry && entry.holder !== null ? this.#hiddenRoots.get(entry.path) : undefined;
      if (registered) value = registered();
      else if (entry) value = entry.holder === null ? this.#rootOf(entry) : this.#readMember(entry);
      // A prototype without a path from the global object, and what a native binding gives.
      if (entry && value === undefined && entry.kind !== "Accessor") value = this.#findById(entry);
      // A holder that is only a heading of the table: the functions that native bindings answer stand under one.
      if (entry && value === undefined && entry.holder !== null) value = this.#findInAnswersOfBindings(token);
    } catch {}
    this.#values.set(token, value);
    return value;
  }

  // The ids of a table that was read from a file may be those of another build, which knows the entry by its token.
  #findById({ token }: DumpedEntry): unknown {
    this.#idsInThisBuild ??= new Map(internals.aotBuiltinEntries().entries.map(entry => [entry.token, entry.id]));
    const id = this.#idsInThisBuild.get(token);
    return id === undefined ? undefined : internals.aotBuiltinValue?.(id, "object");
  }

  // The native code that a compiled program calls without a function object. A helper of the compiler has no other form.
  #findDirectFunction(entry: DumpedEntry, mode: CallMode): unknown {
    this.#idsInThisBuild ??= new Map(internals.aotBuiltinEntries().entries.map(other => [other.token, other.id]));
    const id = this.#idsInThisBuild.get(entry.token);
    const position = entry.overloads.findIndex(overload => overload.mode === mode && !overload.isUndeclared);
    return id === undefined || position < 0 ? undefined : internals.aotBuiltinValue?.(id, `direct:${position}`);
  }

  // A lazily created member is an accessor or a custom property until its first read.
  #readMember(entry: DumpedEntry): unknown {
    const member = this.memberOf(entry);
    if (!member?.descriptor) return undefined;
    if (Object.hasOwn(member.descriptor, "value")) return member.descriptor.value;
    const isData = entry.kind !== "Accessor";
    return isData ? Reflect.get(member.holder!, member.key) : undefined;
  }

  invocationOf(entry: DumpedEntry, mode: CallMode): Invocation | undefined {
    const key = entry.holder === null ? entry.path : this.keyOf(entry);
    const isAccessor = entry.kind === "Accessor";
    // Every evaluation of a native binding runs its native code anew.
    if (entry.kind === "NativeBinding" && mode === "Get") {
      const isInThisBuild = this.#findById(entry) !== undefined;
      return isInThisBuild ? { mode, callee: () => this.#findById(entry), key, callsWhatIsRead: false } : undefined;
    }
    if (!isAccessor && (mode === "Call" || mode === "Construct") && entry.kind !== "DataProperty") {
      const callee = this.valueOf(entry.token) ?? this.#findDirectFunction(entry, mode);
      return typeof callee === "function" ? { mode, callee, key, callsWhatIsRead: false } : undefined;
    }
    // Under a holder that is only a heading of the table there is nothing to read from.
    if (mode === "Get" && !isAccessor && entry.holder !== null && this.valueOf(entry.holder) === undefined) {
      return this.#findById(entry) === undefined ? undefined : { mode, callee: () => this.#findById(entry), key, callsWhatIsRead: false };
    }
    const descriptor = this.memberOf(entry)?.descriptor;
    const accessor = mode === "Set" ? descriptor?.set : descriptor?.get;
    if (isAccessor && typeof accessor !== "function") return undefined;
    const callsWhatIsRead = mode === "Call" || mode === "Construct";
    return { mode, callee: isAccessor ? accessor : undefined, key, callsWhatIsRead };
  }

  #prototypes(): Map<object, string> {
    if (this.#classesByPrototype) return this.#classesByPrototype;
    const classes = new Map<object, string>();
    for (const { token, prototype } of this.table.dump.classes) {
      const value = this.valueOf(prototype);
      if (isObject(value) && !classes.has(value)) classes.set(value, token);
    }
    return (this.#classesByPrototype = classes);
  }

  // Most derived first. A brand decides where JavaScript can see one, the prototype chain decides the rest.
  classesOf(value: unknown): string[] {
    if (!isObject(value)) return [];
    if (types.isProxy(value)) return ["Proxy"];
    const prototypes = this.#prototypes();
    const classes: string[] = [];
    let current: object | null = value;
    while (current !== null && !types.isProxy(current)) {
      const token = current === value ? undefined : prototypes.get(current);
      if (token !== undefined) for (const ancestor of this.table.ancestryOf(token)) if (!classes.includes(ancestor)) classes.push(ancestor);
      current = Reflect.getPrototypeOf(current);
    }
    const native = this.#nativeClassOf(value);
    const general = brandOf(value);
    // A BuildMessage passes for an Error and is none: native code knows it by the class of its cell. A shared buffer has the cell of any buffer.
    const isKnownByCell = native !== undefined && this.table.classes.get(native)?.instanceTest === "ClassInfoInherits";
    const isBelow = native !== undefined && general !== undefined && this.table.isSameOrSubclass(native, general);
    const isAbove = native !== undefined && general !== undefined && this.table.isSameOrSubclass(general, native);
    const brand = native !== undefined && (general === undefined || isBelow || (isKnownByCell && !isAbove)) ? native : general;
    const branded = brand === undefined ? [] : this.table.ancestryOf(brand);
    // The prototype says nothing about a class that native code recognizes by the cell.
    const derived = classes.filter(token => {
      if (branded.includes(token)) return false;
      if (this.table.classes.get(token)?.instanceTest === "None") return brand === undefined || this.table.isSameOrSubclass(token, brand);
      return false;
    });
    return [...derived, ...branded];
  }

  // The class of the cell, which is what an instance test of native code asks for.
  #nativeClassOf(value: object): string | undefined {
    const name = /\(Structure [^:]+:\[[^,]+, ([^,]+),/.exec(jscDescribe(value))?.[1];
    if (name === undefined || name === "Object") return undefined;
    return this.table.classes.has(name) ? name : this.#classesByNativeName().get(name.replaceAll(" ", ""));
  }

  // Native code names a class by the last word of its path: "Headers Iterator", "StringDecoder".
  #classesByNativeName(): Map<string, string> {
    if (this.#nativeNames) return this.#nativeNames;
    const tokens = Map.groupBy(
      this.table.dump.classes.filter(({ instanceTest }) => instanceTest === "ClassInfoInherits"),
      ({ prototype }) => this.table.entries.get(prototype ?? "")?.path.replace(/\.prototype$/, "").split(".").at(-1)!.replaceAll("%", ""),
    );
    this.#nativeNames = new Map([...tokens].flatMap(([name, classes]) => (name !== undefined && classes.length === 1 ? [[name, classes[0].token]] : [])));
    return this.#nativeNames;
  }

  isKnownObject(value: object): boolean {
    if (!this.#knownObjects) {
      this.#knownObjects = new Set([globalThis]);
      for (const entry of this.table.dump.entries) {
        if (entry.kind === "Accessor" || entry.flags.includes("IsLazilyCreated")) continue;
        if (entry.flags.includes("IsOwnPropertyOfInstances")) continue;
        const known = this.valueOf(entry.token);
        if (isObject(known)) this.#knownObjects.add(known);
      }
    }
    return this.#knownObjects.has(value);
  }
}

const typedArrayTag = Reflect.getOwnPropertyDescriptor(prototypeOf(Int8Array.prototype), Symbol.toStringTag)!.get!;

// Its cell says Function, as that of every function does.
function isBoundFunction(value: Function): boolean {
  const name: unknown = Reflect.getOwnPropertyDescriptor(value, "name")?.value;
  return typeof name === "string" && name.startsWith("bound ") && !Object.hasOwn(value, "prototype");
}

// Their cells are named "Object". Neither function looks for a formatter that an older program has put on another object.
const dateTimeFormatToParts = Intl.DateTimeFormat.prototype.formatToParts;
const numberFormatToParts = Intl.NumberFormat.prototype.formatToParts;

function accepts(method: Function, receiver: object): boolean {
  try {
    Reflect.apply(method, receiver, []);
    return true;
  } catch {
    return false;
  }
}

function brandOf(value: object): string | undefined {
  if (Array.isArray(value)) return "Array";
  if (typeof value === "function") return isBoundFunction(value) ? "BoundFunction" : "Function";
  if (types.isTypedArray(value)) return Buffer.isBuffer(value) ? "Buffer" : Reflect.apply(typedArrayTag, value, []);
  if (types.isMap(value)) return "Map";
  if (types.isSet(value)) return "Set";
  if (types.isWeakMap(value)) return "WeakMap";
  if (types.isWeakSet(value)) return "WeakSet";
  if (types.isPromise(value)) return "Promise";
  if (types.isRegExp(value)) return "RegExp";
  if (types.isDate(value)) return "Date";
  if (types.isNativeError(value)) return "Error";
  if (types.isArrayBuffer(value)) return "ArrayBuffer";
  if (types.isSharedArrayBuffer(value)) return "SharedArrayBuffer";
  if (types.isDataView(value)) return "DataView";
  if (types.isArgumentsObject(value)) return "Arguments";
  if (accepts(dateTimeFormatToParts, value)) return "IntlDateTimeFormat";
  if (accepts(numberFormatToParts, value)) return "IntlNumberFormat";
  return undefined;
}
