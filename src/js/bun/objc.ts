// Hardcoded module "bun:objc"
//
// The Objective-C bridge: any Objective-C class and selector by Apple's
// name, plus `app`, the NSApplication lifecycle with its delegate defined
// here. bun:appkit's windows, menus and views are written on this module's
// public surface, and a script uses it for everything they do not cover.
// Natives (binding.ObjCObject / ObjCClass) are handed out wrapped in a Proxy
// whose string properties are selectors. The proxy target is the native
// itself: that keeps it (and the one reference it holds) alive until the
// collector takes the proxy, lets the native side see through proxies passed
// back as arguments, and is what console.log shows. The native side hands
// out one wrapper per object (a class always as an ObjCClass), so one object
// is one proxy and `===` works. The module exports `objc` (the bridge),
// `app` (also `objc.app`) and every member of `objc` by name.

type NativeObjCObject = {
  msgSend(selector: string, ...args: unknown[]): unknown;
  readonly className: string;
  readonly address: bigint;
  release(): void;
  readonly released: boolean;
  /** `-description`. */
  toString(): string;
};

type NativeObjCClass = {
  msgSend(selector: string, ...args: unknown[]): unknown;
  readonly name: string;
  readonly address: bigint;
  toString(): string;
};

type NativeObjC = NativeObjCObject | NativeObjCClass;

type NativeObjCSelector = {
  readonly name: string;
  toString(): string;
};

type Binding = {
  ObjCObject: { prototype: NativeObjCObject };
  ObjCClass: { prototype: NativeObjCClass };
  ObjCSelector: { new (name: string): NativeObjCSelector; prototype: NativeObjCSelector };
  objcLookupClass(name: string): NativeObjCClass;
  objcLookupProtocol(name: string): NativeObjCObject;
  objcJs(value: unknown): unknown;
  objcNs(value: unknown): NativeObjCObject | null;
  objcResponds(object: NativeObjC, selector: string): boolean;
  objcMethodNames(object: NativeObjC): string[];
  objcConstant(name: string, types: string): unknown;
  objcIsBlock(object: NativeObjC): boolean;
  objcInvokeBlock(block: NativeObjCObject, ...args: unknown[]): unknown;
  objcSetHooks(
    dispatch: (
      fn: Function,
      receiver: NativeObjCObject | undefined,
      args: unknown[],
      cls: NativeObjCClass | undefined,
    ) => unknown,
    outs: unknown[],
  ): void;
  objcDefineClass(
    name: string | undefined,
    superclass: unknown,
    protocols: string[],
    selectors: string[],
    types: (string | undefined)[],
    functions: Function[],
    classMethodCount: number,
  ): NativeObjCClass;
  objcTargetClass(): NativeObjCClass;
  objcAttach(object: unknown, table: Record<string, Function>): void;
  objcBlock(fn: Function, types: string): NativeObjCObject;
  objcMsgSendSuper(receiver: NativeObjCObject, cls: NativeObjCClass, selector: string, ...args: unknown[]): unknown;
  objcFunction(
    name: string,
    types: string,
    formatIndex: number | undefined,
    returnsRetained: boolean | undefined,
    retainedOuts: number[] | undefined,
  ): NativeObjCFunction;
};

type NativeObjCFunction = { call(...args: unknown[]): unknown };

/** The native half of `app`; see `AppKitApp` in src/runtime/api/appkit/app.rs. */
type NativeApp = {
  start(delegate: NativeObjCObject | null): void;
  /** Whether `start` already ran on this thread (under an earlier load of this module too). */
  readonly started: boolean;
  launched(): void;
  quitAccepted(): void;
  exitNow(): void;
  hold(on: boolean): void;
  testing(op: string, a?: unknown, b?: unknown): unknown;
};

const binding = $rust("appkit.rs", "createObjcBinding") as Binding & { app: NativeApp };
const nativeApp = binding.app;

const ArrayIsArray = Array.isArray;
const ArrayFrom = Array.from;
const NumberIsInteger = Number.isInteger;
const ObjectKeys = Object.keys;
const ObjectFreeze = Object.freeze;
const ObjectHasOwn = Object.hasOwn;
const ObjectDefineProperty = Object.defineProperty;
const ObjectGetPrototypeOf = Object.getPrototypeOf;

/** What a proxy trap refuses (assigning, defining, deleting): a plain TypeError, as a frozen object's is. */
function typeError(message: string) {
  return new TypeError(message);
}

/**
 * Where the native side leaves (argument index, value) pairs for what a
 * send stored through its out-parameters; {@link send} empties it.
 */
const outs: unknown[] = [];
/**
 * The script-defined methods running now, innermost last: each one's
 * receiver and the class that defines it, which is where `this.super` /
 * `objc.super(this)` sends from inside it start their lookup.
 */
const running: { receiver: NativeObjCObject; cls: NativeObjCClass }[] = [];
// How the native side runs a method of a script-defined class (the receiver
// becomes `this`) or the function behind a block (no receiver), and where it
// leaves what a send stored through its out-parameters. This claims the
// bridge for this global object, so it goes first: if the claim is refused
// nothing else here has run.
binding.objcSetHooks(
  (fn: Function, receiver: NativeObjCObject | undefined, args: unknown[], cls: NativeObjCClass | undefined) => {
    if (receiver === undefined || cls === undefined) {
      return fn.$apply(undefined, fromNative(args) as unknown[]);
    }
    running.push({ receiver, cls });
    try {
      return fn.$apply(fromNative(receiver), fromNative(args) as unknown[]);
    } finally {
      running.pop();
    }
  },
  outs,
);

const ObjCObject = binding.ObjCObject;
const ObjCClass = binding.ObjCClass;
const ObjCSelector = binding.ObjCSelector;
const objcPointer = Symbol("objc.pointer");
const inspectCustom = Symbol.for("nodejs.util.inspect.custom");
/** `NSNotFound` (`NSIntegerMax`), as the bridge returns it. */
const NSNotFound = 9223372036854775807n;

// The natives' own methods, taken once so that a script reaching the shared
// prototype through Object.getPrototypeOf(handle) cannot reroute sends.
const getter = (proto: object, name: string) => Object.getOwnPropertyDescriptor(proto, name)!.get!;
const { msgSend: objectMsgSend, toString: objectToString, release: objectRelease } = ObjCObject.prototype;
const objectClassName = getter(ObjCObject.prototype, "className");
const objectAddress = getter(ObjCObject.prototype, "address");
const objectReleased = getter(ObjCObject.prototype, "released");
const { msgSend: classMsgSend, toString: classToString } = ObjCClass.prototype;
const className = getter(ObjCClass.prototype, "name");
const classAddress = getter(ObjCClass.prototype, "address");

const isClassNative = (native: NativeObjC): native is NativeObjCClass => native instanceof ObjCClass;
const nativeToString = (native: NativeObjC): string =>
  isClassNative(native) ? classToString.$call(native) : objectToString.$call(native);
const nativeAddress = (native: NativeObjC): bigint =>
  isClassNative(native) ? classAddress.$call(native) : objectAddress.$call(native);

/** What console.log and util.inspect show: `[objc NSWindow: <NSWindow: 0x…>]`, `[objc class NSString]`. */
function inspectNative(native: NativeObjC): string {
  if (isClassNative(native)) return `[objc class ${className.$call(native)}]`;
  if (objectReleased.$call(native)) return "[objc released]";
  if (objectAddress.$call(native) === 0n) return `[objc ${objectClassName.$call(native)} alloc]`;
  return `[objc ${objectClassName.$call(native)}: ${objectToString.$call(native)}]`;
}
/** native wrapper -> its proxy, so one wrapper always surfaces as the same object. */
const proxyOfNative = new WeakMap<object, object>();
/** proxy -> native wrapper. */
const nativeOfProxy = new WeakMap<object, NativeObjC>();
// console.log prints a proxy's target, so the natives answer for themselves
// (util.inspect asks the target too, but with the proxy as `this`).
for (const proto of [ObjCObject.prototype, ObjCClass.prototype]) {
  ObjectDefineProperty(proto, inspectCustom, { value: handleInspect });
}

/**
 * `setFrame_display_` -> `setFrame:display:`. Leading
 * underscores are kept, an interior `__` is a literal `_`, and every other
 * `_` is a `:`.
 */
function selectorFromProperty(property: string): string {
  const length = property.length;
  let lead = 0;
  while (lead < length && property.charCodeAt(lead) === 95) lead++;
  let end = length;
  while (end > lead && property.charCodeAt(end - 1) === 95) end--;
  const trailing = length - end;
  let selector = property.slice(0, lead);
  for (let i = lead; i < end; i++) {
    if (property.charCodeAt(i) !== 95) {
      selector += property[i];
    } else if (i + 1 < end && property.charCodeAt(i + 1) === 95) {
      selector += "_";
      i++;
    } else {
      selector += ":";
    }
  }
  for (let i = 0; i < trailing; i++) selector += ":";
  return selector;
}

/** `count:with:` -> `count_with_`; the reverse of {@link selectorFromProperty}. */
function propertyFromSelector(selector: string): string {
  let lead = 0;
  while (lead < selector.length && selector.charCodeAt(lead) === 95) lead++;
  return selector.slice(0, lead) + selector.slice(lead).replaceAll("_", "__").replaceAll(":", "_");
}

/** Natives (at any depth of an array/object the native side built) become proxies, in place. */
function fromNative(value: unknown): unknown {
  if (typeof value !== "object" || value === null || nativeOfProxy.has(value)) return value;
  if (value instanceof ObjCObject || value instanceof ObjCClass) return wrapObject(value);
  if (ArrayIsArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = fromNative(value[i]);
    return value;
  }
  if (ObjectGetPrototypeOf(value) === Object.prototype) {
    const record = value as Record<string, unknown>;
    for (const key of ObjectKeys(record)) record[key] = fromNative(record[key]);
  }
  return value;
}

/**
 * One send (or, with a null selector, one call of the block `native` is):
 * arguments checked, natives in the result and in out-parameters proxied,
 * an Objective-C exception's object proxied too.
 */
function send(native: NativeObjC, selector: string | null, args: ArrayLike<unknown>): unknown {
  const argv: unknown[] = [selector ?? native];
  for (let i = 0; i < args.length; i++) argv.push(args[i]);
  return called(
    () =>
      selector === null
        ? binding.objcInvokeBlock.$apply(undefined, argv as [NativeObjCObject])
        : (isClassNative(native) ? classMsgSend : objectMsgSend).$apply(native, argv),
    argv,
    1,
  );
}

/**
 * The result of `call` (a send, a block call, a C function call) with
 * natives proxied, what it stored through out-parameters moved into the
 * `{ value }` objects among `argv` (its arguments from `first` on), and an
 * Objective-C exception's object proxied.
 */
function called(call: () => unknown, argv: unknown[], first: number): unknown {
  let result: unknown;
  try {
    result = call();
  } catch (error) {
    outs.length = 0;
    throw surfaced(error);
  }
  if (outs.length > 0) {
    try {
      for (let i = 0; i < outs.length; i += 2) {
        (argv[(outs[i] as number) + first] as { value: unknown }).value = fromNative(outs[i + 1]);
      }
    } finally {
      outs.length = 0;
    }
  }
  return fromNative(result);
}

/**
 * The class whose method `native` is inside right now: where `this.super`
 * read there sends from. Read after an `await`, in a timer or in a callback
 * there is no such method on the stack, so the class must be named.
 */
function runningClassOf(native: NativeObjC): NativeObjCClass {
  for (let i = running.length - 1; i >= 0; i--) {
    if (running[i].receiver === native) return running[i].cls;
  }
  throw $ERR_INVALID_ARG_VALUE(
    "this.super / objc.super(object): read outside one of the object's script-defined methods (after an await, in a timer or a callback there is none running); read it inside the method and keep what it gives, or pass the class whose superclass should answer: objc.super(object, objc.classes.MyView)",
  );
}

const superKey = Symbol("super");

/**
 * `this.super` / `objc.super(object, cls?)`: sends answered by the
 * superclass of `cls`, resolved when this is read: inside a script-defined
 * method that is the class defining it (as `[super …]` compiled there), so
 * one kept from a method of a class stays bound to that class however it
 * is used later. One proxy per handle per class.
 */
function superOf(native: NativeObjC, cls: NativeObjCClass): object {
  const table = made(native);
  let perClass = table.get(superKey) as Map<NativeObjCClass, object> | undefined;
  if (perClass === undefined) table.set(superKey, (perClass = new Map()));
  let proxy = perClass.get(cls);
  if (proxy === undefined) perClass.set(cls, (proxy = superProxy(native, cls)));
  return proxy;
}

function superProxy(native: NativeObjC, cls: NativeObjCClass): object {
  const sendSuper = (selector: string, args: ArrayLike<unknown>): unknown => {
    const argv: unknown[] = [native, cls, selector];
    for (let i = 0; i < args.length; i++) argv.push(args[i]);
    return called(
      () => binding.objcMsgSendSuper.$apply(undefined, argv as [NativeObjCObject, NativeObjCClass, string]),
      argv,
      3,
    );
  };
  const methods = new Map<string, Function>();
  return new Proxy(Object.create(null) as Record<string, Function>, {
    get(_target, property) {
      if (typeof property !== "string" || property === "then") return undefined;
      let found = methods.get(property);
      if (found === undefined) {
        if (property === "msgSend") {
          found = function msgSend(selector: unknown, ...args: unknown[]) {
            if (typeof selector !== "string" || selector.length === 0) {
              throw $ERR_INVALID_ARG_TYPE("super.msgSend(selector, ...args): selector must be a non-empty string");
            }
            return sendSuper(selector, args);
          };
        } else {
          const selector = selectorFromProperty(property);
          found = function (...args: unknown[]) {
            return sendSuper(selector, args);
          };
        }
        methods.set(property, found);
      }
      return found;
    },
    set() {
      throw typeError("Cannot assign to a property of objc.super()");
    },
  });
}

/** An Objective-C exception carries the thrown object as a native; hand it out like a result. */
function surfaced(error: unknown): unknown {
  const thrown = error as { code?: unknown; exception?: unknown } | null;
  if (thrown?.code === "ERR_OBJC_EXCEPTION") thrown.exception = fromNative(thrown.exception);
  return error;
}

/**
 * The method a selector-shaped property stands for. The native side counts
 * the arguments: more than the selector has colons only for a variadic
 * method, fewer only when what is left off are out-parameters (passed NULL).
 */
function selectorMethod(native: NativeObjC, property: string): Function {
  const selector = selectorFromProperty(property);
  return function (...args: unknown[]) {
    return send(native, selector, args);
  };
}

/**
 * The few string properties that are not selectors. `toJSON` matters:
 * JSON.stringify would otherwise send `toJSON:`. `release` ends the handle
 * (objects only): the native side refuses the reference-counting selectors.
 * `invoke` calls a block (and is the selector on anything else). `super`
 * is not here: it is resolved on every read (see {@link superOf}).
 */
const reservedMethods = new Map<string, (native: NativeObjC) => object | undefined>([
  [
    "invoke",
    native =>
      binding.objcIsBlock(native)
        ? function invoke(...args: unknown[]) {
            return send(native, null, args);
          }
        : selectorMethod(native, "invoke"),
  ],
  [
    "msgSend",
    native =>
      function msgSend(selector: unknown, ...args: unknown[]) {
        if (typeof selector !== "string" || selector.length === 0) {
          throw $ERR_INVALID_ARG_TYPE("msgSend(selector, ...args): selector must be a non-empty string");
        }
        return send(native, selector, args);
      },
  ],
  [
    "toString",
    native =>
      function toString() {
        return nativeToString(native);
      },
  ],
  [
    "toJSON",
    native =>
      function toJSON() {
        const converted = binding.objcJs(native);
        if (converted === native) return nativeToString(native);
        return converted instanceof Date ? converted.toJSON() : fromNative(converted);
      },
  ],
  [
    "release",
    native =>
      isClassNative(native)
        ? undefined
        : function release() {
            objectRelease.$call(native);
          },
  ],
]);

/**
 * for...of over the Foundation collections, told apart by what they
 * respond to: an `NSIndexSet` yields its indexes, an `NSDictionary` or
 * `NSMapTable` its keys, an `NSEnumerator` what it has left, and anything
 * else with an `objectEnumerator` (`NSArray`, `NSSet`, `NSOrderedSet`,
 * `NSHashTable`) its objects.
 */
function iteratorOf(native: NativeObjCObject): (() => Iterator<unknown>) | undefined {
  const { objcResponds } = binding;
  if (objcResponds(native, "indexGreaterThanIndex:")) {
    return function* indexes() {
      for (let i = send(native, "firstIndex", []); i !== NSNotFound; i = send(native, "indexGreaterThanIndex:", [i])) {
        yield i;
      }
    };
  }
  const enumerator = objcResponds(native, "keyEnumerator")
    ? "keyEnumerator"
    : objcResponds(native, "nextObject")
      ? "self"
      : objcResponds(native, "objectEnumerator")
        ? "objectEnumerator"
        : undefined;
  if (enumerator === undefined) return undefined;
  return function* objects() {
    const each = nativeOfProxy.get(send(native, enumerator, []) as object) as NativeObjCObject;
    for (let item = send(each, "nextObject", []); item !== null; item = send(each, "nextObject", [])) yield item;
  };
}

/** The native behind `this` when a shared function is called on a handle (or on the native itself). */
const nativeOf = (self: unknown): NativeObjC =>
  (typeof self === "object" && self !== null ? nativeOfProxy.get(self) : undefined) ?? (self as NativeObjC);

/** Whether the object behind a handle can still be sent to: not released, and initialized. */
const usable = (native: NativeObjC): boolean =>
  isClassNative(native) || (!objectReleased.$call(native) && objectAddress.$call(native) !== 0n);

// The functions every handle answers for the symbols JavaScript itself
// probes, shared: each reads the handle it was called on.
function handleToPrimitive(this: unknown): string {
  return nativeToString(nativeOf(this));
}
function handleInspect(this: unknown): string {
  return inspectNative(nativeOf(this));
}
function handleDispose(this: unknown): void {
  objectRelease.$call(nativeOf(this) as NativeObjCObject);
}

/**
 * What a handle made for `native` answers on first use, kept so that a
 * property reads as the same function each time: its methods by property
 * name, and its iterator (under `Symbol.iterator`).
 */
const madeForHandle = new WeakMap<NativeObjC, Map<string | symbol, unknown>>();
function made(native: NativeObjC): Map<string | symbol, unknown> {
  let table = madeForHandle.get(native);
  if (table === undefined) madeForHandle.set(native, (table = new Map()));
  return table;
}

function symbolValue(native: NativeObjC, property: symbol): unknown {
  if (property === objcPointer) return nativeAddress(native);
  if (property === Symbol.toPrimitive) return handleToPrimitive;
  if (property === Symbol.toStringTag) return isClassNative(native) ? "ObjCClass" : "ObjCObject";
  if (property === inspectCustom) return handleInspect;
  if (property === Symbol.dispose) return isClassNative(native) ? undefined : handleDispose;
  if (property === Symbol.iterator) {
    if (isClassNative(native) || !usable(native)) return undefined;
    const table = made(native);
    if (!table.has(property)) table.set(property, iteratorOf(native as NativeObjCObject));
    return table.get(property);
  }
  return undefined;
}

/** The method `property` names on `native`, made on first use. Not "then": promises resolve with the object itself rather than sending `then`. */
function methodValue(native: NativeObjC, property: string): unknown {
  if (property === "then") return undefined;
  if (property === "super") return superOf(native, runningClassOf(native));
  const table = made(native);
  let found = table.get(property);
  if (found === undefined && !table.has(property)) {
    found = reservedMethods.get(property)?.(native) ?? selectorMethod(native, property);
    table.set(property, found);
  }
  return found;
}

function responds(native: NativeObjC, property: string | symbol): boolean {
  if (typeof property !== "string") return symbolValue(native, property) !== undefined;
  if (property === "then") return false;
  if (property === "super") return true;
  const reserved = reservedMethods.get(property);
  if (reserved !== undefined) return reserved(native) !== undefined;
  return usable(native) && binding.objcResponds(native, selectorFromProperty(property));
}

// One handler for every handle: each trap reads the native it was made for
// from the proxy target, which is the native itself.
const handleTraps: ProxyHandler<NativeObjC> = {
  get(native, property) {
    return typeof property === "string" ? methodValue(native, property) : symbolValue(native, property);
  },
  // `"count" in list`: whether the receiver responds to the selector.
  has(native, property) {
    return responds(native, property);
  },
  // The selectors the receiver's classes implement, spelled as properties:
  // only those a property can spell back (an `_` before a trailing colon,
  // or `::` away from the end, cannot be), so every key answers `in`.
  ownKeys(native) {
    if (!usable(native)) return [];
    const names = new Set<string>();
    for (const name of binding.objcMethodNames(native)) {
      const property = propertyFromSelector(name);
      if (selectorFromProperty(property) === name) names.add(property);
    }
    return [...names];
  },
  getOwnPropertyDescriptor(native, property) {
    if (!responds(native, property)) return undefined;
    // Resolved on read, and only inside a method: described as the accessor it is.
    if (property === "super") {
      return { get: () => methodValue(native, property), enumerable: false, configurable: true };
    }
    const value = typeof property === "string" ? methodValue(native, property) : symbolValue(native, property);
    return { value, writable: false, enumerable: typeof property === "string", configurable: true };
  },
  set(_native, property) {
    throw typeError(
      `Cannot assign to ${String(property)} on an Objective-C object; call the setter, e.g. setTitle_(value)`,
    );
  },
  defineProperty() {
    throw typeError("Cannot define properties on an Objective-C object");
  },
  deleteProperty() {
    throw typeError("Cannot delete properties of an Objective-C object");
  },
};

function wrapObject(native: NativeObjC): object {
  let proxy = proxyOfNative.get(native);
  if (proxy !== undefined) return proxy;
  proxy = new Proxy(native, handleTraps);
  proxyOfNative.set(native, proxy);
  nativeOfProxy.set(proxy, native);
  return proxy;
}

/**
 * A read-only table whose entries `lookup` computes by name (a class, a
 * protocol, a constant), once for those `keep` accepts (all of them by
 * default). The names JavaScript itself probes (await, String(),
 * JSON.stringify) read as absent: they are never Objective-C names.
 */
function namedTable<T>(
  label: string,
  lookup: (name: string) => T,
  keep: (value: T) => boolean = () => true,
): Record<string, T> {
  const readOnly = () => {
    throw typeError(`${label} is read-only`);
  };
  const toName = () => `[${label}]`;
  const cache = new Map<string, T>();
  return new Proxy(Object.create(null) as Record<string, T>, {
    get(_target, name) {
      if (name === "then") return undefined;
      if (name === "toString" || name === "toJSON" || name === Symbol.toPrimitive) return toName;
      if (typeof name !== "string") return undefined;
      let value = cache.get(name);
      if (value === undefined) {
        value = lookup(name);
        if (keep(value)) cache.set(name, value);
      }
      return value;
    },
    set: readOnly,
    defineProperty: readOnly,
    deleteProperty: readOnly,
  });
}

// Classes and protocols are immortal; the tables' caches keep their one handle each alive.
const objcClasses = namedTable("objc.classes", name => wrapObject(binding.objcLookupClass(name)));
const objcProtocols = namedTable("objc.protocols", name => wrapObject(binding.objcLookupProtocol(name)));

/** The generated enum and constant tables (`scripts/appkit-enums.ts`), loaded on first use. */
let loadedEnumTables: typeof import("../internal/appkit_enums").default | undefined;
const enumTables = () =>
  (loadedEnumTables ??= require("internal/appkit_enums") as typeof import("../internal/appkit_enums").default);

/** An exported constant by name, read as `type` (default: the generated table's, else an object). */
function constant(name: string, options?: { type?: string }): unknown {
  if (typeof name !== "string" || name.length === 0)
    throw $ERR_INVALID_ARG_TYPE("objc.constant(name): name must be a non-empty string");
  let type = options?.type;
  if (type !== undefined && typeof type !== "string")
    throw $ERR_INVALID_ARG_TYPE("objc.constant(name, { type }): type must be a type encoding string");
  const { constants } = enumTables();
  if (type === undefined) {
    type = ObjectHasOwn(constants, name) ? constants[name] : "@";
    // The SDK declares it as something the bridge cannot read (a table of
    // function pointers, a `FILE *`); reading it as an object would guess.
    if (type === "?")
      throw $ERR_INVALID_ARG_VALUE(
        `objc: the constant ${name} does not hold an Objective-C object; pass its C type, as in objc.constant("${name}", { type: "d" }) for a double or { type: "{CGRect=dddd}" } for a struct`,
      );
  }
  return fromNative(binding.objcConstant(name, type));
}

// Only numbers and booleans are cached. An object constant is looked up each
// time: `NSApp` is nil until the application exists, and the handle table
// already makes repeat reads `===`; a struct constant is a fresh object each
// time, so changing one read cannot change the next.
const objcConstants = namedTable(
  "objc.constants",
  name => constant(name),
  value => value !== null && typeof value !== "object",
);

/** `PNGFileType` -> `pngFileType`, `Titled` -> `titled`, `URL` -> `url`: the first word in lower case. */
function lowerFirstWord(suffix: string): string {
  const first = /^[A-Z]+(?![a-z])|^[A-Z]/.exec(suffix)?.[0] ?? "";
  return first.toLowerCase() + suffix.slice(first.length);
}

/**
 * One enum: its members by short name (`titled`) and by full name
 * (`NSWindowStyleMaskTitled`), frozen. Built on first use from the
 * generated `[prefix, suffix, value, ...]` row.
 */
function enumObject(typeName: string, row: (string | number | bigint)[]): Readonly<Record<string, number | bigint>> {
  const prefix = row[0] as string;
  const members: Record<string, number | bigint> = Object.create(null);
  for (let i = 1; i < row.length; i += 2) {
    const suffix = row[i] as string;
    const value = row[i + 1] as number | bigint;
    if (suffix.startsWith("=")) {
      members[suffix.slice(1)] = value;
    } else {
      members[lowerFirstWord(suffix)] = value;
      members[prefix + suffix] = value;
    }
  }
  ObjectDefineProperty(members, Symbol.toStringTag, { value: typeName });
  return ObjectFreeze(members);
}

/** Every member of every enum by its full name, built once on the first lookup that needs it. */
let enumMembers: Map<string, number | bigint> | undefined;

const objcEnums = namedTable("objc.enums", name => {
  const { enums, loose } = enumTables();
  if (ObjectHasOwn(enums, name)) return enumObject(name, enums[name]);
  if (ObjectHasOwn(loose, name)) return loose[name];
  if (enumMembers === undefined) {
    enumMembers = new Map();
    for (const typeName of ObjectKeys(enums)) {
      const row = enums[typeName];
      const prefix = row[0] as string;
      for (let i = 1; i < row.length; i += 2) {
        const suffix = row[i] as string;
        enumMembers.set(suffix.startsWith("=") ? suffix.slice(1) : prefix + suffix, row[i + 1] as number | bigint);
      }
    }
  }
  const member = enumMembers.get(name);
  if (member !== undefined) return member;
  throw $ERR_OBJC_NOT_FOUND(
    `objc.enums: no enum or constant named "${name}" in the Foundation, AppKit, QuartzCore or Metal headers`,
  );
});

/** A method whose result never changes can be given as the result. */
type ScriptConstant = boolean | number | bigint | null;
type ScriptMethod =
  | Function
  | ScriptConstant
  | { types?: string; fn: Function }
  | { types?: string; value: ScriptConstant };
const isScriptConstant = (value: unknown): value is ScriptConstant =>
  value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "bigint";
type ClassDefinition = {
  name?: string;
  superclass?: string | object;
  protocols?: string[];
  methods: Record<string, ScriptMethod>;
  classMethods?: Record<string, ScriptMethod>;
};

const classNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

function defineClass(definition: ClassDefinition): object {
  if (typeof definition !== "object" || definition === null) {
    throw $ERR_INVALID_ARG_TYPE("objc.defineClass(definition): definition must be an object");
  }
  const { name, superclass = "NSObject", protocols = [], methods, classMethods = {} } = definition;
  if (name !== undefined && (typeof name !== "string" || !classNamePattern.test(name))) {
    throw $ERR_INVALID_ARG_TYPE("objc.defineClass(): name must be a string of letters, digits and _");
  }
  // The application delegate class is this module's to define, on first need: a subclass is one.
  if (superclass === "BunApplicationDelegate") applicationDelegateClass();
  const superclassHandle = typeof superclass === "string" ? objcClasses[superclass] : superclass;
  if (!ArrayIsArray(protocols)) {
    throw $ERR_INVALID_ARG_TYPE("objc.defineClass(): protocols must be an array of protocol names");
  }
  if (typeof methods !== "object" || methods === null) {
    throw $ERR_INVALID_ARG_TYPE("objc.defineClass(): methods must be an object of functions keyed by selector");
  }
  if (typeof classMethods !== "object" || classMethods === null) {
    throw $ERR_INVALID_ARG_TYPE("objc.defineClass(): classMethods must be an object of functions keyed by selector");
  }
  const selectors: string[] = [];
  const types: (string | undefined)[] = [];
  /** Each method's function, or its constant result. */
  const bodies: unknown[] = [];
  const collect = (table: Record<string, ScriptMethod>, which: "methods" | "classMethods") => {
    for (const key of ObjectKeys(table)) {
      const method = table[key] as ScriptMethod | undefined;
      let body: unknown = method;
      let encoding: unknown;
      if (typeof method === "object" && method !== null) {
        body = "fn" in method ? method.fn : (method as { value?: unknown }).value;
        encoding = method.types;
      }
      if (
        (typeof body !== "function" && !isScriptConstant(body)) ||
        (encoding !== undefined && typeof encoding !== "string")
      ) {
        throw $ERR_INVALID_ARG_TYPE(
          `objc.defineClass(): ${which}[${JSON.stringify(key)}] must be a function, a constant (boolean, number or null), or { types, fn } or { types, value } with types a string`,
        );
      }
      const lead = key.charCodeAt(0);
      if (lead === 43 || lead === 45) {
        throw $ERR_INVALID_ARG_VALUE(
          `objc.defineClass(): ${which}[${JSON.stringify(key)}]: leave the ${key[0]} off; instance methods go in \`methods\` and class methods in \`classMethods\``,
        );
      }
      // A key spelled the way sends are (`tableView_objectValueForTableColumn_row_`) names the same selector.
      const selector = key.includes(":") ? key : selectorFromProperty(key);
      let colons = 0;
      for (let i = 0; i < selector.length; i++) if (selector.charCodeAt(i) === 58) colons++;
      const declared = typeof body === "function" ? body.length : 0;
      if (declared > colons) {
        throw $ERR_INVALID_ARG_VALUE(
          `objc.defineClass(): "${selector}" takes ${colons} argument${colons === 1 ? "" : "s"} but its function declares ${declared}`,
        );
      }
      selectors.push(selector);
      types.push(encoding as string | undefined);
      bodies.push(body);
    }
  };
  collect(methods, "methods");
  const instanceCount = selectors.length;
  collect(classMethods, "classMethods");
  return fromNative(
    binding.objcDefineClass(
      name,
      superclassHandle,
      protocols,
      selectors,
      types,
      bodies,
      selectors.length - instanceCount,
    ),
  ) as object;
}

/**
 * `objc.fn()`'s options: the return type and argument types as encodings,
 * which argument is a format whose `%@`s the rest fill, and who owns the
 * objects it returns and stores where the SDK's headers are not consulted.
 */
type FunctionTypes = {
  returns?: string;
  args?: readonly string[];
  format?: number;
  returnsRetained?: boolean;
  retainedOuts?: readonly number[];
};

/** The exported C function `name`, typed `types` (return type then one encoding per argument), as a JavaScript function. */
function functionNamed(
  name: string,
  types: string,
  format: number | undefined,
  returnsRetained?: boolean,
  retainedOuts?: number[],
): (...args: unknown[]) => unknown {
  const native = binding.objcFunction(name, types, format, returnsRetained, retainedOuts);
  const call = native.call;
  return {
    [name](...args: unknown[]) {
      return called(() => call.$apply(native, args), args, 0);
    },
  }[name];
}

/** `objc.fn(name, { returns, args, format })`. */
function cFunction(name: string, types?: FunctionTypes): (...args: unknown[]) => unknown {
  if (typeof name !== "string" || name.length === 0) {
    throw $ERR_INVALID_ARG_TYPE("objc.fn(name, types): name must be a non-empty string");
  }
  if (types !== undefined && (typeof types !== "object" || types === null)) {
    throw $ERR_INVALID_ARG_TYPE("objc.fn(name, types): types must be an object { returns, args }");
  }
  const { returns = "v", args = [], format, returnsRetained, retainedOuts } = types ?? {};
  if (
    typeof returns !== "string" ||
    returns.length === 0 ||
    !ArrayIsArray(args) ||
    !args.every(a => typeof a === "string" && a.length > 0)
  ) {
    throw $ERR_INVALID_ARG_TYPE(
      "objc.fn(name, { returns, args }): returns must be a type encoding and args an array of type encodings",
    );
  }
  const isIndex = (i: unknown): boolean => NumberIsInteger(i) && (i as number) >= 0 && (i as number) < args.length;
  if (format !== undefined && !isIndex(format)) {
    throw $ERR_INVALID_ARG_VALUE("objc.fn(name, { format }): format must be the index of the format string among args");
  }
  if (returnsRetained !== undefined && typeof returnsRetained !== "boolean") {
    throw $ERR_INVALID_ARG_TYPE("objc.fn(name, { returnsRetained }): returnsRetained must be a boolean");
  }
  if (retainedOuts !== undefined && (!ArrayIsArray(retainedOuts) || !retainedOuts.every(isIndex))) {
    throw $ERR_INVALID_ARG_VALUE(
      "objc.fn(name, { retainedOuts }): retainedOuts must be an array of indexes among args",
    );
  }
  return functionNamed(
    name,
    returns + args.join(""),
    format,
    returnsRetained,
    retainedOuts === undefined ? undefined : ArrayFrom(retainedOuts),
  );
}

/** The generated table's functions (`scripts/appkit-enums.ts`), each made on first use. */
const objcFunctions = namedTable("objc.functions", name => {
  const { functions } = enumTables();
  if (!ObjectHasOwn(functions, name)) {
    throw $ERR_OBJC_NOT_FOUND(
      `objc.functions: no function named "${name}" in the Foundation, AppKit, CoreGraphics or CoreFoundation headers; reach another with objc.fn(name, { returns, args })`,
    );
  }
  const entry = functions[name];
  return typeof entry === "string" ? functionNamed(name, entry, undefined) : functionNamed(name, entry[0], entry[1]);
});

/** The one class behind every thread's objc.target(): `action:` looks its function up on the instance. */
let targetClass: { new: () => object } | undefined;

// ---------------------------------------------------------------------------
// app: the NSApplication lifecycle. Starting, the keep-alive and process exit
// are native (`nativeApp`); the application delegate, the quit sequence,
// activation, the Dock badge and appearance are sends from here.

/** A wrapped native as scripts see it: every property is a selector-shaped method. */
type Handle = { [selector: string]: (...args: unknown[]) => any };
type AppListener = (...args: unknown[]) => unknown;

const appEvents = ["beforequit", "willquit", "reopen"];
const appListeners = new Map<string, Set<AppListener>>();
/** AppKit is up on this thread: by this load of the module, or by an earlier one (each file under `bun test --isolate` loads it afresh). */
let started = nativeApp.started;
/** A quit got past every veto; later requests neither ask again nor can be vetoed. */
let quitting = false;
let activationPolicy = "regular";
let appBadge: string | null = null;
/** Outstanding `app.retain()` tokens. */
let retained = 0;
/** What the script set as `app.delegate`: an instance of `BunApplicationDelegate` or of a subclass. */
let userDelegate: Handle | null = null;
/** The instance of `BunApplicationDelegate` this module made, once one was needed. */
let ownDelegate: Handle | undefined;
let appDelegateClass: Handle | undefined;
/** Hears `NSApplicationDidFinishLaunchingNotification`, whatever the delegate is; made with the delegate class. */
let launchObserver: Handle | undefined;

/** `NSApplicationActivationPolicy` by the names scripts use. */
const activationPolicies: Record<string, number> = { regular: 0, accessory: 1, background: 2 };
/** `NSApplicationTerminateReply`. */
const terminateCancel = 0;
const terminateNow = 1;

function nsapp(): Handle {
  return (objcClasses as Record<string, Handle>).NSApplication.sharedApplication();
}

/** A listener that throws must not stop the others or change their verdict; the error surfaces the way an uncaught one does. */
function guardedCall(fn: Function, args: unknown[]): unknown {
  try {
    return fn.$apply(undefined, args);
  } catch (error) {
    reportError(error);
    return undefined;
  }
}

function emitApp(event: string, args: unknown[]): void {
  const set = appListeners.get(event);
  if (set) for (const fn of Array.from(set)) guardedCall(fn, args);
}

/** Every listener of a vetoable event runs (one that throws is reported, not counted); false when any vetoed. */
function askListeners(name: string): boolean {
  let vetoed = false;
  const event = {
    preventDefault() {
      vetoed = true;
    },
    get defaultPrevented() {
      return vetoed;
    },
  };
  const set = appListeners.get(name);
  if (set) {
    for (const fn of Array.from(set)) {
      if (guardedCall(fn, [event]) === false) vetoed = true;
    }
  }
  return !vetoed;
}

/**
 * The one question behind Cmd-Q, the Quit menu item, the Dock's Quit, a
 * logout (`applicationShouldTerminate:`) and `app.quit()`, in two rounds:
 * every `beforequit` listener may veto and none may act on the quit yet;
 * only when none did, every `willquit` listener (bun:appkit closes its
 * windows in one) may act and may still veto. False when either round
 * vetoed. An accepted quit is not asked about again.
 */
function askQuit(): boolean {
  if (quitting) return true;
  return askListeners("beforequit") && askListeners("willquit");
}

/** Asks, and when nobody vetoes has the process exit at the next loop turn. */
function requestQuit(): boolean {
  if (!askQuit()) return false;
  if (!quitting) {
    quitting = true;
    nativeApp.quitAccepted();
  }
  return true;
}

/**
 * `BunApplicationDelegate`: the application delegate, defined here so a
 * script can subclass it (`objc.defineClass({ superclass:
 * "BunApplicationDelegate", … })`) and set an instance as `app.delegate`.
 * It carries only what has no other route: the quit question and the
 * reopen event. Start-up completes through a notification instead, so a
 * subclass that overrides without calling up cannot stall it.
 */
function applicationDelegateClass(): Handle {
  if (appDelegateClass !== undefined) return appDelegateClass;
  appDelegateClass = defineClass({
    name: "BunApplicationDelegate",
    protocols: ["NSApplicationDelegate"],
    methods: {
      "applicationShouldTerminate:"() {
        // AppKit's own terminate: asked: a YES ends in applicationWillTerminate:
        // below, so nothing is scheduled here, and a subclass may still turn
        // the YES into NSTerminateLater.
        return askQuit() ? terminateNow : terminateCancel;
      },
      "applicationWillTerminate:"() {
        // AppKit calls exit() when this returns; run the process's own exit path first.
        quitting = true;
        nativeApp.exitNow();
      },
      "applicationShouldHandleReopen:hasVisibleWindows:"(_sender: unknown, visible: boolean) {
        emitApp("reopen", [!!visible]);
        return true;
      },
      "applicationSupportsSecureRestorableState:": true,
    },
  }) as Handle;
  const Observer = defineClass({
    name: "BunApplicationObserver",
    methods: {
      "launched:": {
        types: "v@:@",
        fn() {
          nativeApp.launched();
        },
      },
    },
  }) as Handle;
  launchObserver = Observer.new() as Handle;
  (objcClasses as Record<string, Handle>).NSNotificationCenter.defaultCenter().addObserver_selector_name_object_(
    launchObserver,
    "launched:",
    constant("NSApplicationDidFinishLaunchingNotification"),
    null,
  );
  return appDelegateClass;
}

/** The object to install as `-[NSApplication delegate]`: the script's, else this module's instance. */
function effectiveDelegate(): Handle {
  const Class = applicationDelegateClass();
  return userDelegate ?? (ownDelegate ??= Class.new());
}

function holdProcess(): void {
  nativeApp.hold(retained > 0);
}

/**
 * `-[NSApplication activationPolicy]` by name. AppKit keeps the policy, not
 * this module: a send of `setActivationPolicy:` changes what this reads.
 */
function liveActivationPolicy(): string {
  const live = Number(nsapp().activationPolicy());
  return ObjectKeys(activationPolicies).find(name => activationPolicies[name] === live) ?? activationPolicy;
}

/** `-[NSApplication setActivationPolicy:]` by name; it answers NO for a change it will not make. */
function applyActivationPolicy(value: string): void {
  if (!nsapp().setActivationPolicy_(activationPolicies[value])) {
    throw $ERR_INVALID_STATE(`the activation policy cannot be changed to "${value}" now`);
  }
}

function startApp(policy?: unknown): void {
  if (policy !== undefined) app.activationPolicy = policy as string;
  if (started) return;
  // Off the main thread the native side refuses the start before anything
  // else matters, so nothing is touched there.
  if (Bun.isMainThread) applyActivationPolicy(activationPolicy);
  nativeApp.start(Bun.isMainThread ? (nativeOfProxy.get(effectiveDelegate()) as NativeObjCObject) : null);
  started = true;
  // App Nap follows the hold once there is an application to tell.
  holdProcess();
  if (appBadge !== null) nsapp().dockTile().setBadgeLabel_(appBadge);
}

/** `app.retain()`'s token: holds the process open until released (once). */
class AppHold {
  #held = true;
  release(): void {
    if (!this.#held) return;
    this.#held = false;
    retained--;
    holdProcess();
  }
  get released(): boolean {
    return !this.#held;
  }
  [Symbol.dispose](): void {
    this.release();
  }
}

const app = {
  start: startApp,
  get isRunning(): boolean {
    return started;
  },
  get activationPolicy(): string {
    return started && Bun.isMainThread ? liveActivationPolicy() : activationPolicy;
  },
  set activationPolicy(value: string) {
    if (typeof value !== "string" || !ObjectHasOwn(activationPolicies, value)) {
      throw $ERR_INVALID_ARG_VALUE('app.activationPolicy must be "regular", "accessory" or "background"');
    }
    if (started && Bun.isMainThread && value !== liveActivationPolicy()) applyActivationPolicy(value);
    activationPolicy = value;
  },
  get badge(): string | null {
    return appBadge;
  },
  set badge(value: string | number | null) {
    appBadge = value == null || value === "" ? null : String(value);
    if (started) nsapp().dockTile().setBadgeLabel_(appBadge);
  },
  get isDark(): boolean {
    if (!started) return false;
    return String(nsapp().effectiveAppearance().name()).includes("Dark");
  },
  get hasDisplay(): boolean {
    return (objcClasses as Record<string, Handle>).NSScreen.screens().count() > 0;
  },
  /** The `-[NSApplication delegate]`: this module's `BunApplicationDelegate` instance, or the script's instance of a subclass. */
  get delegate(): object | null {
    return userDelegate ?? (started ? effectiveDelegate() : null);
  },
  set delegate(value: object | null) {
    if (
      value !== null &&
      (typeof value !== "object" ||
        !(nativeOfProxy.get(value) instanceof ObjCObject) ||
        !(value as Handle).isKindOfClass_(applicationDelegateClass()))
    ) {
      throw $ERR_INVALID_ARG_TYPE(
        'app.delegate must be an instance of BunApplicationDelegate or of a subclass (objc.defineClass({ superclass: "BunApplicationDelegate", methods: { … } })), or null',
      );
    }
    userDelegate = value as Handle | null;
    if (started) nsapp().setDelegate_(effectiveDelegate());
  },
  activate(): void {
    startApp();
    nsapp().activateIgnoringOtherApps_(true);
  },
  hide(): void {
    if (started) nsapp().hide_(null);
  },
  quit(): void {
    // Before anything started AppKit there is nobody to ask: plain process.exit().
    if (!started) nativeApp.exitNow();
    else requestQuit();
  },
  retain(): AppHold {
    retained++;
    holdProcess();
    return new AppHold();
  },
  on(event: string, listener: AppListener) {
    if (!appEvents.includes(event)) throw $ERR_INVALID_ARG_VALUE(`Unknown app event "${event}"`);
    if (typeof listener !== "function") throw $ERR_INVALID_ARG_TYPE("listener must be a function");
    let set = appListeners.get(event);
    if (!set) appListeners.set(event, (set = new Set()));
    set.add(listener);
    return app;
  },
  off(event: string, listener: AppListener) {
    appListeners.get(event)?.delete(listener);
    return app;
  },
};

const objc = {
  app,
  classes: objcClasses,
  protocols: objcProtocols,
  constants: objcConstants,
  constant,
  enums: objcEnums,
  functions: objcFunctions,
  fn: cFunction,
  /** Sends answered by the superclass: `objc.super(this).drawRect_(rect)` inside a defined method, or with the class given. */
  super(object: unknown, cls?: unknown): object {
    const native = typeof object === "object" && object !== null ? nativeOfProxy.get(object) : undefined;
    if (native === undefined)
      throw $ERR_INVALID_ARG_TYPE("objc.super(object, cls?): object must be an Objective-C handle");
    let clsNative: NativeObjCClass | undefined;
    if (cls !== undefined) {
      const c = typeof cls === "object" && cls !== null ? nativeOfProxy.get(cls) : undefined;
      if (c === undefined || !isClassNative(c))
        throw $ERR_INVALID_ARG_TYPE("objc.super(object, cls): cls must be a class handle");
      clsNative = c;
    }
    return superOf(native, clsNative ?? runningClassOf(native));
  },
  pointer: objcPointer,
  NSNotFound,
  sel(name: string): NativeObjCSelector {
    if (typeof name !== "string" || name.length === 0) {
      throw $ERR_INVALID_ARG_TYPE("objc.sel(name): name must be a non-empty string");
    }
    return new ObjCSelector(name);
  },
  /** A Foundation value object as plain data (natives inside it proxied); anything else as it was, untouched. */
  js(value: unknown): unknown {
    const converted = binding.objcJs(value);
    if (converted !== value) return fromNative(converted);
    // A bare native (never handed out through a proxy) gets its proxy; a proxy is already one.
    return (value instanceof ObjCObject || value instanceof ObjCClass) && !nativeOfProxy.has(value as object)
      ? wrapObject(value)
      : value;
  },
  ns(value: unknown): object | null {
    return fromNative(binding.objcNs(value)) as object | null;
  },
  /** One object is one handle, so this is `===` between handles; anything that is not a handle is not the same. */
  same(a: unknown, b: unknown): boolean {
    return a === b && typeof a === "object" && a !== null && nativeOfProxy.has(a);
  },
  /** Storage for an out-parameter (`NSError **`, `BOOL *`, `NSRange *`): pass it, then read `.value`. */
  out<T>(value?: T): { value: T | undefined } {
    return { value };
  },
  defineClass,
  target(fn: (sender: object | null) => unknown): object {
    if (typeof fn !== "function") throw $ERR_INVALID_ARG_TYPE("objc.target(fn): fn must be a function");
    targetClass ??= fromNative(binding.objcTargetClass()) as { new: () => object };
    const target = targetClass.new();
    binding.objcAttach(target, { "action:": fn });
    return target;
  },
  /** Without `types`: no result and one object per parameter `fn` declares. */
  block(fn: Function, types?: string): object {
    if (typeof fn !== "function") throw $ERR_INVALID_ARG_TYPE("objc.block(fn, types): fn must be a function");
    if (types === undefined) types = "v@?" + "@".repeat(fn.length);
    else if (typeof types !== "string") throw $ERR_INVALID_ARG_TYPE("objc.block(fn, types): types must be a string");
    return fromNative(binding.objcBlock(fn, types)) as object;
  },
};

// Loaded again on a thread where an earlier load started AppKit (each file
// under `bun test --isolate`): take the delegate over.
if (started && Bun.isMainThread) {
  nativeApp.start(nativeOfProxy.get(effectiveDelegate()) as NativeObjCObject);
}

// What bun:internal-for-testing reaches that is not public API.
(require("internal/appkit_private") as typeof import("../internal/appkit_private").default).testing = (op, a, b) =>
  nativeApp.testing(op, a, b);

// The bridge's members are also the module's named exports (`classes`,
// `defineClass`, ...), next to `objc` itself and `app`.
export default { ...objc, objc };
