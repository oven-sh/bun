// What the interfaces that windows and workers share are made with. One instance for each realm.
const core = require("internal/desktop/web/dom").core;
const events = require("internal/desktop/web/dom").events;

/** Filled in by `electron/realm`. `env` belongs to the main realm of the thread. */
const scope = {
  env: undefined as any,
  global: globalThis as any,
  page: undefined as any,
  /** On the clock of the thread. */
  timeOrigin: 0,
  isWindow: false,
  disposed: false,
  cleanups: new Set<() => void>(),
  baseUrl: (): string => "",
  /** Of the document, for the queries of URLs. */
  encoding: (): string => "utf-8",
  report: (_error: unknown): void => {},
  reportAt: (_error: { message: string; filename: string; lineno: number; colno: number; error: unknown }): void => {},
  dispose: (): void => {},
  /** The string for a sink of Trusted Types. */
  trusted: (kind: string, value: unknown, _sink: string): string => (kind === "scriptURL" ? usv(value) : `${value}`),
  isHandlerName: (name: string): boolean =>
    [events.globalHandlers, events.windowHandlers, events.clipboardHandlers].some(names => names.includes(name)),
  evaluate: (_source: string, _url: string): unknown => undefined,
};

/** For the modules that have something of the same name. */
const native = { BroadcastChannel, MessageChannel, MessagePort, WebSocket, atob, btoa, structuredClone };

/** The first argument of a constructor that scripts cannot call. */
const internal = Symbol();

function illegal(key: unknown) {
  if (key !== internal) throw new TypeError("Illegal constructor");
}

function need(given: number, wanted: number) {
  if (given < wanted)
    throw new TypeError(`${wanted} argument${wanted > 1 ? "s" : ""} required, but only ${given} present.`);
}

function enumerate(target: object, except: string[]) {
  for (const name of Object.getOwnPropertyNames(target)) {
    if (!except.includes(name)) Object.defineProperty(target, name, { enumerable: true });
  }
}

/** `constants` are numbered from 0. */
function expose<T extends { prototype: object; name: string }>(constructor: T, constants: string[] = []): T {
  const { prototype } = constructor;
  enumerate(prototype, ["constructor"]);
  enumerate(constructor, ["length", "name", "prototype"]);
  Object.defineProperty(prototype, Symbol.toStringTag, { value: constructor.name, configurable: true });
  if ($getByIdDirectPrivate(prototype, "cloner") === undefined)
    $putByIdDirectPrivate(prototype as any, "cloner", false);
  constants.forEach((name, value) => {
    for (const target of [constructor, prototype]) Object.defineProperty(target, name, { value, enumerable: true });
  });
  return constructor;
}

/** A read-only attribute. */
function attribute(constructor: any, name: string, read: (self: any) => unknown) {
  const holder = {
    get [name]() {
      if (!(this instanceof constructor)) throw new TypeError("Illegal invocation");
      return read(this);
    },
  };
  core.accessor(constructor.prototype, name, Object.getOwnPropertyDescriptor(holder, name)!.get);
}

/** `[Replaceable]` */
function replaceable(target: object, name: string, read: () => unknown) {
  const holder = {
    get [name]() {
      return read();
    },
    set [name](value: unknown) {
      Object.defineProperty(this ?? target, name, { value, writable: true, enumerable: true, configurable: true });
    },
  };
  Object.defineProperty(target, name, Object.getOwnPropertyDescriptor(holder, name)!);
}

/** `serialize` returns a plain object, whose `kind` says which module `electron/realm` hands the clone of it to. */
function serializable(prototype: object, serialize: (value: any, isForStorage: boolean) => object | undefined) {
  $putByIdDirectPrivate(prototype as any, "cloner", serialize);
}

const error = (name: string, message: string) =>
  name === "QuotaExceededError"
    ? new (require("internal/desktop/web/navigator").QuotaExceededError)(message)
    : new DOMException(message, name);
const usv = (value: unknown): string => `${value}`.toWellFormed();

function byteString(value: unknown): string {
  const text = `${value}`;
  if (/[^\0-\xff]/.test(text)) throw new TypeError("String contains non ISO-8859-1 code point.");
  return text;
}

function dictionary(value: any): any {
  if (value == null) return {};
  if (!$isObject(value)) throw new TypeError("The provided value is not a dictionary.");
  return value;
}

function oneOf(value: unknown, allowed: string[]): string {
  const text = `${value}`;
  if (!allowed.includes(text)) throw new TypeError(`The provided value '${text}' is not a valid enum value.`);
  return text;
}

function sequence(value: any): any[] {
  if (!$isObject(value) || !$isCallable(value[Symbol.iterator])) {
    throw new TypeError("The provided value cannot be converted to a sequence.");
  }
  return [...(value as any)];
}

/** `[EnforceRange]` */
function inRange(value: any, most = Number.MAX_SAFE_INTEGER, least = 0): number {
  const number = Math.trunc(+value);
  if (!(number >= least && number <= most)) throw new TypeError("Value is outside the range of the type.");
  return number + 0;
}

function unsignedLongLong(value: any): number {
  const number = Math.trunc(+value);
  return Number.isFinite(number) ? (number < 0 ? 2 ** 64 + (number % 2 ** 64) : number % 2 ** 64) : 0;
}

function finite(value: any): number {
  const number = +value;
  if (!Number.isFinite(number)) throw new TypeError("The provided double value is non-finite.");
  return number;
}

function callable(value: unknown): Function {
  if (!$isCallable(value)) throw new TypeError("The provided callback is not a function.");
  return value as Function;
}

function signalOf(value: unknown): AbortSignal {
  if (!$isAbortSignal(value)) throw new TypeError("The provided value is not of type 'AbortSignal'.");
  return value as AbortSignal;
}

const { isAnyArrayBuffer, isSharedArrayBuffer } = require("node:util/types");

/** Not a copy. Undefined for what is not a `BufferSource`. */
function bytesOf(value: any): Uint8Array | undefined {
  const isView = ArrayBuffer.isView(value);
  if (!isView && !isAnyArrayBuffer(value)) return;
  if (isSharedArrayBuffer(isView ? value.buffer : value)) throw new TypeError("The buffer must not be shared.");
  if (((isView ? value.buffer : value) as any).detached) return new Uint8Array();
  return isView ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : new Uint8Array(value);
}

/** Whether it is an instance of a native class, of any realm. `method` has to take no arguments. */
function isBranded(constructor: any, method: string, value: unknown) {
  try {
    constructor.prototype[method].$call(value);
    return true;
  } catch {
    return false;
  }
}

function parseUrl(url: string, usesEncoding = false): URL | null {
  if (!usesEncoding || scope.encoding() === "utf-8") return URL.parse(url, scope.baseUrl());
  return require("internal/desktop/web/encoding").parseUrl(url, scope.baseUrl(), scope.encoding());
}

/** A trusted event. False if it was canceled. */
const dispatch = (target: any, event: object): boolean => events.dispatchFromScript(target.$impl, event, true);
const fire = (target: any, type: string): boolean => events.fire(target.$impl, type);

function runTask(run: (argument?: any) => void, argument?: unknown) {
  const { tasks } = scope.env;
  if (tasks.isSuspended()) return queueTask(run, argument);
  tasks.finishCheckpoint();
  if (!scope.disposed) events.fromEventLoop(() => run(argument), scope.page);
}

/** Microtasks run after each listener of the events that it dispatches with `events.dispatch` and `fire`. */
function queueTask(run: (argument?: any) => void, argument?: unknown) {
  const { tasks } = scope.env;
  tasks.post(tasks.VISIBLE, runTask, run, argument);
}

/** For a promise of the main realm. What follows from it is a task, and errors are made anew. */
function adopt<T, U>(
  promise: Promise<T>,
  convert: (value: T) => U,
  fail: (error: any) => unknown = ownError,
): Promise<U> {
  const { promise: own, resolve, reject } = Promise.withResolvers<U>();
  promise.then(
    value => {
      try {
        resolve(convert(value));
      } catch (error) {
        reject(error);
      }
    },
    error => reject(fail(error)),
  );
  return own;
}

function ownError({ name, message }: any) {
  if (name === "Error") return new Error(message);
  if (name === "RangeError") return new RangeError(message);
  return name === "TypeError" ? new TypeError(message) : error(name, message);
}

type Convert = (value: any) => unknown;

/** An event that only has the members of its dictionary: each with what converts it, and a default unless required. */
function eventClass(name: string, members: Record<string, [Convert, unknown?]>): any {
  const isRequired = Object.values(members).some(member => member.length === 1);
  const names = Object.keys(members).sort();
  const constructor = {
    [name]: class extends events.Event {
      #values: Record<string, unknown> = {};

      constructor(type: string, init: any = undefined) {
        need(arguments.length, isRequired ? 2 : 1);
        init = dictionary(init);
        super(type, init);
        for (const key of names) {
          const value = init[key];
          if (value === undefined && members[key].length === 1)
            throw new TypeError(`Required member ${key} is undefined.`);
          this.#values[key] = value === undefined ? members[key][1] : members[key][0](value);
        }
      }

      static {
        for (const key of names) {
          const { get } = Object.getOwnPropertyDescriptor(
            {
              get [key]() {
                return (this as any).#values[key];
              },
            },
            key,
          )!;
          core.accessor(this.prototype, key, get);
        }
      }
    },
  }[name];
  Object.defineProperty(constructor, "length", { value: isRequired ? 2 : 1 });
  return expose(constructor);
}

/** `entries`, `keys`, `values` and `forEach` over pairs, which may change meanwhile. */
function iterable(constructor: { prototype: any; name: string }, pairsOf: (self: any) => unknown[][]) {
  class PairIterator {
    #target: object;
    #kind: number;
    #index = 0;

    constructor(target: object, kind: number) {
      pairsOf((this.#target = target));
      this.#kind = kind;
    }

    next() {
      const pair = pairsOf(this.#target)[this.#index];
      if (pair === undefined) return { value: undefined, done: true };
      this.#index++;
      return { value: this.#kind === 2 ? [pair[0], pair[1]] : pair[this.#kind], done: false };
    }
  }
  const prototype: any = PairIterator.prototype;
  Object.setPrototypeOf(prototype, Iterator.prototype);
  delete prototype.constructor;
  enumerate(prototype, []);
  Object.defineProperty(prototype, Symbol.toStringTag, { value: constructor.name + " Iterator", configurable: true });
  Object.assign(constructor.prototype, {
    entries() {
      return new PairIterator(this, 2);
    },
    keys() {
      return new PairIterator(this, 0);
    },
    values() {
      return new PairIterator(this, 1);
    },
    forEach(callback: Function, thisArgument: unknown = undefined) {
      pairsOf(this);
      callable(callback);
      for (let i = 0, pairs; i < (pairs = pairsOf(this)).length; i++)
        (callback as any).$call(thisArgument, pairs[i][1], pairs[i][0], this);
    },
  });
  Object.defineProperty(constructor.prototype, Symbol.iterator, {
    value: constructor.prototype.entries,
    writable: true,
    configurable: true,
  });
}

export default {
  Event: events.Event,
  EventTarget: events.EventTarget,
  adopt,
  attribute,
  byteString,
  bytesOf,
  isBranded,
  callable,
  defineHandlers: events.defineHandlers,
  dictionary,
  dispatch,
  dispatchInTask: (target: any, event: any): boolean => events.dispatch(target.$impl, event),
  error,
  eventClass,
  expose,
  finite,
  fire,
  hasListeners: (target: any, type: string): boolean => events.hasListeners(target.$impl, type),
  illegal,
  inRange,
  internal,
  iterable,
  native,
  need,
  oneOf,
  ownError,
  parseUrl,
  queueTask,
  replaceable,
  runTask,
  scope,
  sequence,
  serializable,
  signalOf,
  string: (value: unknown): string => `${value}`,
  unsignedLongLong,
  usv,
};
