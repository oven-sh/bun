// IndexedDB. `storage.ts` keeps, for all the pages of an origin, the sorted keys of each store and index.
const idl = require("internal/desktop/web/idl");
const events = require("internal/desktop/web/dom").events;
const types = require("node:util/types");
const { serialize, deserialize } = require("bun:jsc");

const { Event, EventTarget, defineHandlers, error: fail, expose, internal, need, queueTask: later, scope } = idl;
const unit = String.fromCharCode;
const view = new DataView(new ArrayBuffer(8));

function encodeNumber(value: number) {
  view.setFloat64(0, value + 0);
  const flip = view.getUint8(0) & 0x80 ? 0xffff : 0;
  let out = "";
  for (let i = 0; i < 8; i += 2) out += unit(view.getUint16(i) ^ (flip || (i === 0 ? 0x8000 : 0)));
  return out;
}

/** Strings that sort like the keys, and of which none starts with another. */
function tryEncode(key: any, seen: unknown[] = []): string | undefined {
  if (typeof key === "number") return key === key ? "\x10" + encodeNumber(key) : undefined;
  if (typeof key === "string") {
    return "\x30" + key.replace(/[\0\x01]/g, (found: string) => "\x01" + unit(found.charCodeAt(0) + 1)) + "\0";
  }
  if (types.isDate(key)) return tryEncode(Date.prototype.getTime.$call(key))?.replace("\x10", "\x20");
  if (types.isAnyArrayBuffer(key) || types.isArrayBufferView(key)) {
    if (((key as any).buffer ?? key).detached) return;
    const bytes = (key as any).buffer
      ? new Uint8Array((key as any).buffer, (key as any).byteOffset, key.byteLength)
      : new Uint8Array(key as any);
    let out = "\x40";
    for (const byte of bytes) out += unit(byte + 1);
    return out + "\0";
  }
  if (!$isArray(key) || types.isProxy(key) || seen.includes(key) || seen.length > 2000) return;
  let out = "\x50";
  for (let i = 0, { length } = key; i < length; i++) {
    const encoded = Object.hasOwn(key, i) ? tryEncode(key[i], [...seen, key]) : undefined;
    if (encoded === undefined) return;
    out += encoded;
  }
  return out + "\0";
}

function encode(key: unknown) {
  const encoded = tryEncode(key);
  if (encoded === undefined) throw fail("DataError", "The parameter is not a valid key.");
  return encoded;
}

/** The key at `start`, and where it ends. */
function decodeAt(text: string, start: number): [any, number] {
  const kind = text[start++];
  if (kind === "\x10" || kind === "\x20") {
    const flip = text.charCodeAt(start) & 0x8000 ? 0 : 0xffff;
    for (let i = 0; i < 4; i++) view.setUint16(i * 2, text.charCodeAt(start + i) ^ (flip || (i === 0 ? 0x8000 : 0)));
    const value = view.getFloat64(0);
    return [kind === "\x10" ? value : new Date(value), start + 4];
  }
  if (kind === "\x50") {
    const items: unknown[] = [];
    while (text[start] !== "\0") {
      const [item, end] = decodeAt(text, start);
      $putByValDirect(items, items.length, item);
      start = end;
    }
    return [items, start + 1];
  }
  const end = text.indexOf("\0", start);
  const body = text.slice(start, end);
  if (kind === "\x40") return [Uint8Array.from(body, (byte: string) => byte.charCodeAt(0) - 1).buffer, end + 1];
  return [body.replace(/\x01([^])/g, (_, found: string) => unit(found.charCodeAt(0) - 1)), end + 1];
}

const decode = (text: string) => decodeAt(text, 0)[0];
/** Sorts after everything that starts with an encoded key, and before the next key. */
const PAST = "\x60";

/** The first index whose item is not less than `key`. */
function lowerBound(list: string[], key: string) {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (list[middle] < key) low = middle + 1;
    else high = middle;
  }
  return low;
}

const isBlob = (value: unknown) => /^\[object (?:Blob|File)]$/.test(Object.prototype.toString.$call(value));

function evaluateKeyPath(value: any, path: string | string[]): any {
  if ($isArray(path)) {
    const parts = path.map(part => evaluateKeyPath(value, part));
    return parts.includes(undefined) ? undefined : parts;
  }
  if (path === "") return value;
  for (const name of path.split(".")) {
    const isOwn = $isObject(value) ? Object.hasOwn(value, name) : typeof value === "string" && name === "length";
    if (!isOwn && !(/^(?:size|type|name|lastModified)$/.test(name) && isBlob(value))) return;
    value = value[name];
  }
  return value;
}

function canInjectKey(value: any, path: string) {
  for (const name of path.split(".").slice(0, -1)) {
    if (!$isObject(value)) return false;
    if (!Object.hasOwn(value, name)) return true;
    value = value[name];
  }
  return $isObject(value);
}

function injectKey(value: any, path: string, key: number) {
  const names = path.split(".");
  const last = names.pop()!;
  for (const name of names) {
    if (!Object.hasOwn(value, name)) $putByValDirect(value, name, {});
    value = value[name];
  }
  $putByValDirect(value, last, key);
}

const toKeyPath = (path: any) =>
  $isObject(path) && path[Symbol.iterator] ? idl.sequence(path).map(idl.string) : `${path}`;
const isOnePath = (path: string) =>
  path === "" || path.split(".").every(it => /^[$_\p{IDS}][$\u200c\u200d\p{IDC}]*$/u.test(it));

function validateKeyPath(path: string | string[]) {
  if ($isArray(path) ? path.length > 0 && path.every(isOnePath) : isOnePath(path)) return;
  throw fail("SyntaxError", "The keyPath argument contains an invalid key path.");
}

const names = (list: string[]) => events.stringList(list.toSorted());

let isRange: (value: unknown) => value is IDBKeyRange;
let boundsOf: (range: IDBKeyRange) => [string, string];

class IDBKeyRange {
  #lower?: string;
  #upper?: string;
  #lowerOpen: boolean;
  #upperOpen: boolean;

  constructor(key: unknown = undefined, lower?: string, upper?: string, lowerOpen = true, upperOpen = true) {
    idl.illegal(key);
    this.#lower = lower;
    this.#upper = upper;
    this.#lowerOpen = lowerOpen;
    this.#upperOpen = upperOpen;
  }

  static {
    isRange = (value): value is IDBKeyRange => $isObject(value) && #lower in (value as object);
    boundsOf = range => [
      range.#lower === undefined ? "" : range.#lower + (range.#lowerOpen ? PAST : ""),
      range.#upper === undefined ? PAST : range.#upper + (range.#upperOpen ? "" : PAST),
    ];
  }

  static only(key: unknown) {
    need(arguments.length, 1);
    const encoded = encode(key);
    return new IDBKeyRange(internal, encoded, encoded, false, false);
  }

  static lowerBound(key: unknown, open = false) {
    need(arguments.length, 1);
    return new IDBKeyRange(internal, encode(key), undefined, !!open, true);
  }

  static upperBound(key: unknown, open = false) {
    need(arguments.length, 1);
    return new IDBKeyRange(internal, undefined, encode(key), true, !!open);
  }

  static bound(lower: unknown, upper: unknown, lowerOpen = false, upperOpen = false) {
    need(arguments.length, 2);
    const [from, to] = [encode(lower), encode(upper)];
    if (from > to || (from === to && (lowerOpen || upperOpen))) {
      throw fail("DataError", "The lower key is greater than the upper key.");
    }
    return new IDBKeyRange(internal, from, to, !!lowerOpen, !!upperOpen);
  }

  get lower() {
    return this.#lower === undefined ? undefined : decode(this.#lower);
  }

  get upper() {
    return this.#upper === undefined ? undefined : decode(this.#upper);
  }

  get lowerOpen() {
    return this.#lowerOpen;
  }

  get upperOpen() {
    return this.#upperOpen;
  }

  includes(key: unknown) {
    const [from, to] = boundsOf(this);
    need(arguments.length, 1);
    const encoded = encode(key);
    return encoded >= from && encoded < to;
  }
}

/** From the first string up to, and without, the second. */
function bounds(query: unknown, required = false): [string, string] {
  if (isRange(query)) return boundsOf(query);
  if (query == null && !required) return ["", PAST];
  const key = encode(query);
  return [key, key + PAST];
}

const IDBVersionChangeEvent = idl.eventClass("IDBVersionChangeEvent", {
  oldVersion: [idl.unsignedLongLong, 0],
  newVersion: [value => (value === null ? null : idl.unsignedLongLong(value)), null],
});

const dispatchAlong = (event: object, ...path: any[]) =>
  events.dispatchAlong(
    path.map(it => it.$impl),
    event,
  );
const errorEvent = () => new Event("error", { bubbles: true, cancelable: true });

type RequestState = { source: unknown; transaction: unknown; done: boolean; result?: unknown; error: unknown };
let stateOf: (request: IDBRequest) => RequestState;

class IDBRequest extends EventTarget {
  #it: RequestState;

  constructor(key: unknown = undefined, source: unknown = null, transaction: unknown = null) {
    idl.illegal(key);
    super();
    this.#it = { source, transaction, done: false, result: undefined, error: null };
  }

  static {
    stateOf = request => request.#it;
  }

  #finished() {
    if (!this.#it.done) throw fail("InvalidStateError", "The request has not finished.");
    return this.#it;
  }

  get result() {
    return this.#finished().result;
  }
  get error() {
    return this.#finished().error;
  }
  get source() {
    return this.#it.source;
  }
  get transaction() {
    return this.#it.transaction;
  }
  get readyState() {
    return this.#it.done ? "done" : "pending";
  }
}
defineHandlers(IDBRequest.prototype, ["success", "error"]);

class IDBOpenDBRequest extends IDBRequest {}
defineHandlers(IDBOpenDBRequest.prototype, ["blocked", "upgradeneeded"]);

function settle(request: IDBRequest, result: unknown, error: unknown = null) {
  Object.assign(stateOf(request), { done: true, result, error });
}

const aborted = () => fail("AbortError", "The transaction was aborted.");

class Transaction {
  handle = new IDBTransaction(internal, this);
  started = false;
  active = true;
  committing = false;
  finished = false;
  error: unknown = null;
  onFinish: ((committed: boolean) => void) | undefined;
  stores = new Map<object, IDBObjectStore>();
  /** What puts things back if it is aborted, but not if just one request fails. */
  undoLast: (() => void)[] = [];
  #requests: { request?: IDBRequest; run: () => unknown }[] = [];
  #undo: (() => void)[] = [];
  #isStepQueued = false;
  /** By table and key. `null` is a deletion. */
  #written = new Map<number, Map<string, Uint8Array | null>>();
  #cleared: number[] = [];

  constructor(
    readonly connection: Connection,
    readonly scope: string[],
    readonly mode: string,
    readonly durability: string,
  ) {
    connection.backend.enqueue(this);
  }

  get backend() {
    return this.connection.backend;
  }

  deactivateAfterMicrotasks() {
    let isDone = false;
    const deactivate = () => {
      if (isDone) return;
      isDone = true;
      this.active = false;
      this.#proceed();
    };
    events.afterMicrotasks.push(deactivate);
    scope.env.tasks.afterMicrotasks(deactivate);
  }

  /** Called by the backend. */
  start() {
    this.started = true;
    this.#proceed();
  }

  #proceed() {
    if (!this.started || this.active || this.finished || this.#isStepQueued) return;
    this.#isStepQueued = true;
    later(() => this.#step());
  }

  check(writes = false) {
    if (!this.active) throw fail("TransactionInactiveError", "The transaction is not active.");
    if (writes && this.mode === "readonly") throw fail("ReadOnlyError", "The transaction is read-only.");
  }

  request(source: unknown, run: () => unknown, request = new IDBRequest(internal, source, this.handle)) {
    this.#requests.push({ request, run });
    return request;
  }

  /** What no script is told about, unless it fails. */
  schedule(run: () => void) {
    this.#requests.push({ run });
  }

  clone(value: unknown): Uint8Array {
    this.active = false;
    try {
      return serialize(value, { binaryType: "nodebuffer" });
    } finally {
      this.active = !this.finished;
    }
  }

  /** It is active meanwhile. */
  fire(event: object, request: IDBRequest, error?: unknown) {
    this.active = !this.committing;
    const path =
      this.mode === "versionchange" && request instanceof IDBOpenDBRequest ? [] : [this.handle, this.connection.handle];
    const [wasNotCanceled, didThrow] = dispatchAlong(event, request, ...path);
    const wasActive = this.active;
    this.active = false;
    if (didThrow && wasActive) this.abort(aborted());
    else if (error && wasNotCanceled) this.abort(error);
    this.#proceed();
  }

  #step(): any {
    this.#isStepQueued = false;
    if (this.finished) return;
    const next = this.#requests[0];
    if (!next && this.mode === "readonly") return this.#finish(true);
    if (!next) {
      this.#isStepQueued = this.committing = true;
      return void scope.env.tasks.post(scope.env.tasks.HOST, idl.runTask, () => this.finished || this.#commit());
    }
    const { request, run } = next;
    const undoFrom = this.#undo.length;
    let result;
    try {
      result = run();
    } catch (error) {
      if (!request || this.committing) return this.abort(error);
      this.#requests.shift();
      while (this.#undo.length > undoFrom) this.#undo.pop()!();
      settle(request, undefined, error);
      return this.fire(errorEvent(), request, error);
    }
    this.#requests.shift();
    if (!request) return this.#step();
    settle(request, result);
    this.fire(new Event("success"), request);
  }

  #finish(committed: boolean) {
    this.finished = true;
    this.active = false;
    later(() => {
      if (this.mode === "versionchange") this.connection.upgrade = undefined;
      this.backend.dequeue(this);
      if (committed) dispatchAlong(new Event("complete"), this.handle);
      else dispatchAlong(new Event("abort", { bubbles: true }), this.handle, this.connection.handle);
      this.onFinish?.(committed);
    });
  }

  #commit() {
    try {
      this.backend.commit(this.#cleared, this.#written);
    } catch (error: any) {
      return this.abort(fail("UnknownError", error.message));
    }
    this.#finish(true);
  }

  commit() {
    this.committing = true;
    this.active = false;
    this.#proceed();
  }

  abort(error: unknown) {
    if (this.finished) return;
    while (this.#undo.length > 0) this.#undo.pop()!();
    while (this.undoLast.length > 0) this.undoLast.pop()!();
    this.error = error;
    for (const { request } of this.#requests.splice(0)) {
      if (!request) continue;
      later(() => {
        settle(request, undefined, aborted());
        dispatchAlong(errorEvent(), request, this.handle, this.connection.handle);
      });
    }
    this.#finish(false);
  }

  /** For when the realm ends. */
  discardIfGone() {
    if (!scope.disposed) return;
    this.abort(null);
    this.backend.dequeue(this);
  }

  setNextKey(store: any, nextKey: number) {
    const before = store.nextKey;
    store.nextKey = nextKey;
    this.#undo.push(() => (store.nextKey = before));
  }

  read(table: number, key: string) {
    return deserialize(this.#written.$get(table)?.$get(key) ?? this.backend.value(table, key));
  }

  write(table: number, key: string, value: Uint8Array | null) {
    const keys: string[] = this.backend.keys(table);
    const at = lowerBound(keys, key);
    const existed = keys[at] === key;
    if (existed && value === null) keys.splice(at, 1);
    else if (!existed && value !== null) keys.splice(at, 0, key);
    let written = this.#written.$get(table);
    if (!written) this.#written.$set(table, (written = new Map()));
    const before = written.$get(key);
    written.$set(key, value);
    this.#undo.push(() => {
      if (before === undefined) written.$delete(key);
      else written.$set(key, before);
      const at = lowerBound(keys, key);
      if (existed && value === null) keys.splice(at, 0, key);
      else if (!existed && value !== null) keys.splice(at, 1);
    });
  }

  clear(table: number) {
    const keys: string[] = this.backend.keys(table);
    const before = keys.splice(0);
    const written = this.#written.$get(table);
    this.#written.$delete(table);
    this.#cleared.push(table);
    this.#undo.push(() => {
      for (const key of before) keys.push(key);
      if (written) this.#written.$set(table, written);
      this.#cleared.pop();
    });
  }
}

const NO_VALUE = new Uint8Array(0);

function indexKeys(index: any, value: unknown): string[] {
  const key = evaluateKeyPath(value, index.keyPath);
  const keys = index.multiEntry && $isArray(key) ? Object.values(key) : [key];
  return [...new Set(keys.map(key => tryEncode(key)))].filter(key => key !== undefined) as string[];
}

function addToIndex(transaction: Transaction, index: any, value: unknown, primary: string) {
  for (const key of indexKeys(index, value)) {
    const entries = transaction.backend.keys(index.table);
    if (index.unique && entries[lowerBound(entries, key)]?.startsWith(key)) {
      throw fail("ConstraintError", "At least one key does not satisfy the uniqueness requirements.");
    }
    transaction.write(index.table, key + primary, NO_VALUE);
  }
}

function removeRecord(transaction: Transaction, store: any, indexes: any[], key: string) {
  if (indexes.length > 0) {
    const value = transaction.read(store.table, key);
    for (const index of indexes) {
      for (const indexKey of indexKeys(index, value)) transaction.write(index.table, indexKey + key, null);
    }
  }
  transaction.write(store.table, key, null);
}

const LAST_KEY = 2 ** 53;
const keyAfter = (key: number) => (key >= LAST_KEY ? LAST_KEY * 2 : Math.floor(key) + 1);

/** `expected` is the key that has to be in the value. */
function storeRecord(
  source: unknown,
  { transaction, store }: State,
  value: any,
  key: any,
  replaces: boolean,
  expected?: string,
) {
  const { keyPath, autoIncrement } = store;
  if (keyPath !== null && key !== undefined) {
    throw fail("DataError", "The object store uses in-line keys and the key parameter was provided.");
  }
  if (keyPath === null && key === undefined && !autoIncrement) {
    throw fail(
      "DataError",
      "The object store uses out-of-line keys and has no key generator and the key parameter was not provided.",
    );
  }
  let encoded = key === undefined ? undefined : encode(key);
  let bytes = transaction.clone(value);
  transaction.check();
  let copy = keyPath === null ? undefined : deserialize(bytes);
  if (keyPath !== null) {
    key = evaluateKeyPath(copy, keyPath);
    if (key !== undefined || !autoIncrement || expected !== undefined) encoded = encode(key);
    else if (!canInjectKey(copy, keyPath)) throw fail("DataError", "The key cannot be stored in the value.");
    if (expected !== undefined && encoded !== expected) {
      throw fail("DataError", "The key of the value does not match the cursor's effective key.");
    }
  }
  const indexes = Object.values(store.indexes);
  return transaction.request(source, () => {
    if (encoded === undefined) {
      if (store.nextKey > LAST_KEY) throw fail("ConstraintError", "The key generator has run out of keys.");
      encoded = encode((key = store.nextKey));
      transaction.setNextKey(store, keyAfter(key));
      if (keyPath !== null) {
        injectKey(copy, keyPath, key);
        bytes = serialize(copy, { binaryType: "nodebuffer" });
      }
    } else if (autoIncrement && typeof key === "number" && key >= store.nextKey) {
      transaction.setNextKey(store, Math.max(keyAfter(key), store.nextKey));
    }
    const keys = transaction.backend.keys(store.table);
    if (keys[lowerBound(keys, encoded)] === encoded) {
      if (!replaces) throw fail("ConstraintError", "Key already exists in the object store.");
      removeRecord(transaction, store, indexes, encoded);
    }
    transaction.write(store.table, encoded, bytes);
    for (const index of indexes) addToIndex(transaction, index, (copy ??= deserialize(bytes)), encoded);
    return decode(encoded);
  });
}

class IDBRecord {
  #parts: unknown[];

  constructor(key: unknown = undefined, ...parts: unknown[]) {
    idl.illegal(key);
    this.#parts = parts;
  }

  get key() {
    return this.#parts[0];
  }
  get primaryKey() {
    return this.#parts[1];
  }
  get value() {
    return this.#parts[2];
  }
}

/** Of the handle of a store or an index. An entry of an index is its key and then the key of the record. */
type State = {
  transaction: Transaction;
  store: any;
  index?: any;
  name: string;
  keyPath: unknown;
  objectStore?: object;
};

const directions = ["next", "nextunique", "prev", "prevunique"];
const keyOf = ({ index }: State, entry: string) => (index ? entry.slice(0, decodeAt(entry, 0)[1]) : entry);
const primaryOf = ({ index }: State, entry: string) => (index ? entry.slice(decodeAt(entry, 0)[1]) : entry);
const entriesOf = ({ transaction, index, store }: State): string[] => transaction.backend.keys((index ?? store).table);
const readValue = (it: State, entry: string) => it.transaction.read(it.store.table, primaryOf(it, entry));
const readKey = (it: State, entry: string) => decode(primaryOf(it, entry));
const readRecord = (it: State, entry: string) =>
  new IDBRecord(internal, decode(entry), readKey(it, entry), readValue(it, entry));

function requireExisting({ store, index }: State) {
  if (store.deleted || index?.deleted) throw fail("InvalidStateError", "The object store or index has been deleted.");
}

function checked(it: State, writes = false) {
  requireExisting(it);
  it.transaction.check(writes);
  return it;
}

function upgrading(transaction: Transaction | undefined, it?: State) {
  if (transaction?.mode !== "versionchange") {
    throw fail("InvalidStateError", "The database is not running a version change transaction.");
  }
  if (it) requireExisting(it);
  transaction.check();
  return transaction;
}

const toCount = (count: unknown) => (count === undefined ? 0 : idl.inRange(count, 2 ** 32 - 1));

function toGetAllOptions(given: unknown) {
  const { count, direction = "next", query } = idl.dictionary(given);
  return { count: toCount(count), direction: idl.oneOf(direction, directions), query };
}

const mayBeKey = (value: any) =>
  !$isObject(value) ||
  isRange(value) ||
  $isArray(value) ||
  types.isDate(value) ||
  types.isAnyArrayBuffer(value) ||
  ArrayBuffer.isView(value);

/** What stores and indexes have in common. */
function defineReading(prototype: object, it: (self: any) => State) {
  function select(
    source: object,
    query: any,
    required: boolean,
    pick: (entries: string[], from: number, to: number) => unknown,
  ) {
    const state = checked(it(source));
    const [lower, upper] = bounds(query, required);
    return state.transaction.request(source, () => {
      const entries = entriesOf(state);
      return pick(entries, lowerBound(entries, lower), lowerBound(entries, upper));
    });
  }
  function all(source: object, { count, direction, query }: any, read: typeof readKey) {
    const state = it(source);
    return select(source, query, false, (entries, from, to) => {
      let chosen = entries.slice(from, count && direction === "next" ? Math.min(to, from + count) : to);
      if (direction.endsWith("unique"))
        chosen = chosen.filter((entry, i) => !i || keyOf(state, entry) !== keyOf(state, chosen[i - 1]));
      if (direction[0] === "p") chosen.reverse();
      return Array.from(chosen.slice(0, count || Infinity), entry => read(state, entry));
    });
  }
  function allOf(source: object, given: unknown, count: unknown, read: typeof readKey) {
    const limit = toCount(count);
    checked(it(source));
    return all(
      source,
      mayBeKey(given) ? { count: limit, direction: "next", query: given } : toGetAllOptions(given),
      read,
    );
  }
  const members = {
    get keyPath() {
      return it(this).keyPath;
    },
    get(query: unknown) {
      need(arguments.length, 1);
      return select(this, query, true, (entries, from, to) =>
        from < to ? readValue(it(this), entries[from]) : undefined,
      );
    },
    getKey(query: unknown) {
      need(arguments.length, 1);
      return select(this, query, true, (entries, from, to) =>
        from < to ? readKey(it(this), entries[from]) : undefined,
      );
    },
    getAll(query: unknown = undefined, count: unknown = undefined) {
      return allOf(this, query, count, readValue);
    },
    getAllKeys(query: unknown = undefined, count: unknown = undefined) {
      return allOf(this, query, count, readKey);
    },
    getAllRecords(options: unknown = undefined) {
      return all(this, toGetAllOptions(options), readRecord);
    },
    count(query: unknown = undefined) {
      return select(this, query, false, (_, from, to) => Math.max(to - from, 0));
    },
    openCursor(query: unknown = undefined, direction = "next") {
      return openCursor(IDBCursorWithValue, this, it(this), query, direction);
    },
    openKeyCursor(query: unknown = undefined, direction = "next") {
      return openCursor(IDBCursor, this, it(this), query, direction);
    },
  };
  Object.defineProperties(prototype, Object.getOwnPropertyDescriptors(members));
}

function rename(it: State, table: Record<string, any>, name: string) {
  const transaction = upgrading(it.transaction, it);
  const before = it.name;
  if (name === before) return;
  if (name in table) throw fail("ConstraintError", "The name is already in use.");
  const move = (from: string, to: string) => {
    table[to] = table[from];
    delete table[from];
  };
  move(before, (it.name = name));
  transaction.undoLast.push(() => {
    move(name, before);
    if (!created.has(table[before])) it.name = before;
  });
}

/** The stores and indexes that the running upgrade has made. */
let created = new WeakSet<object>();

function create(transaction: Transaction, table: object, name: string, made: any) {
  created.add((table[name] = made));
  transaction.undoLast.push(() => {
    delete table[name];
    made.deleted = true;
  });
}

function remove(transaction: Transaction, table: object, name: string) {
  const found = table[name];
  if (!found) throw fail("NotFoundError", `'${name}' was not found.`);
  delete table[name];
  found.deleted = true;
  transaction.undoLast.push(() => {
    table[name] = found;
    delete found.deleted;
  });
  transaction.schedule(() => {
    for (const { table } of [found, ...Object.values(found.indexes ?? {})] as any[]) transaction.clear(table);
  });
}

const ownKeyPath = (path: any) => ($isArray(path) ? [...path] : path);

class IDBIndex {
  #it: State;

  constructor(key: unknown = undefined, it?: State) {
    idl.illegal(key);
    this.#it = it!;
  }

  static {
    defineReading(this.prototype, self => self.#it);
  }

  get name() {
    return this.#it.name;
  }
  set name(name: string) {
    rename(this.#it, this.#it.store.indexes, `${name}`);
  }
  get objectStore() {
    return this.#it.objectStore;
  }
  get unique() {
    return this.#it.index.unique;
  }
  get multiEntry() {
    return this.#it.index.multiEntry;
  }
}

class IDBObjectStore {
  #it: State;
  #indexes = new Map<object, IDBIndex>();

  constructor(key: unknown = undefined, it?: State) {
    idl.illegal(key);
    this.#it = it!;
  }

  static {
    defineReading(this.prototype, self => self.#it);
  }

  get name() {
    return this.#it.name;
  }
  set name(name: string) {
    rename(this.#it, this.#it.transaction.backend.meta.stores, `${name}`);
  }
  get autoIncrement() {
    return this.#it.store.autoIncrement;
  }
  get indexNames() {
    const { store } = this.#it;
    return names(store.deleted ? [] : Object.keys(store.indexes));
  }
  get transaction() {
    return this.#it.transaction.handle;
  }

  put(value: unknown, key: unknown = undefined) {
    need(arguments.length, 1);
    return storeRecord(this, checked(this.#it, true), value, key, true);
  }

  add(value: unknown, key: unknown = undefined) {
    need(arguments.length, 1);
    return storeRecord(this, checked(this.#it, true), value, key, false);
  }

  delete(query: unknown) {
    need(arguments.length, 1);
    const { transaction, store } = checked(this.#it, true);
    const [lower, upper] = bounds(query, true);
    const indexes = Object.values(store.indexes);
    return transaction.request(this, () => {
      const keys = transaction.backend.keys(store.table);
      for (const key of keys.slice(lowerBound(keys, lower), lowerBound(keys, upper))) {
        removeRecord(transaction, store, indexes, key);
      }
    });
  }

  clear() {
    const { transaction, store } = checked(this.#it, true);
    const tables: any[] = [store, ...Object.values(store.indexes)];
    return transaction.request(this, () => {
      for (const { table } of tables) transaction.clear(table);
    });
  }

  index(name: string) {
    const { transaction, store } = this.#it;
    need(arguments.length, 1);
    name = `${name}`;
    if (transaction.finished || store.deleted) throw fail("InvalidStateError", "The transaction has finished.");
    const index = store.indexes[name];
    if (!index) throw fail("NotFoundError", "The specified index was not found.");
    let handle = this.#indexes.$get(index);
    if (!handle) {
      const it = { transaction, store, index, name, keyPath: ownKeyPath(index.keyPath), objectStore: this };
      this.#indexes.$set(index, (handle = new IDBIndex(internal, it)));
    }
    return handle;
  }

  createIndex(name: string, keyPath: any, options: unknown = undefined) {
    const { store } = this.#it;
    need(arguments.length, 2);
    name = `${name}`;
    keyPath = toKeyPath(keyPath);
    const { multiEntry, unique } = idl.dictionary(options);
    const transaction = upgrading(this.#it.transaction, this.#it);
    if (name in store.indexes) throw fail("ConstraintError", "An index with the specified name already exists.");
    validateKeyPath(keyPath);
    if (multiEntry && $isArray(keyPath))
      throw fail("InvalidAccessError", "The key path of a multiEntry index is an array.");
    const index = { table: transaction.backend.newTable(), keyPath, unique: !!unique, multiEntry: !!multiEntry };
    create(transaction, store.indexes, name, index);
    transaction.schedule(() => {
      for (const key of transaction.backend.keys(store.table))
        addToIndex(transaction, index, transaction.read(store.table, key), key);
    });
    return this.index(name);
  }

  deleteIndex(name: string) {
    const it = this.#it;
    need(arguments.length, 1);
    name = `${name}`;
    remove(upgrading(it.transaction, it), it.store.indexes, name);
  }
}

let cursorState: (cursor: IDBCursor) => any;

function requireValue({ ready }: any) {
  if (!ready) throw fail("InvalidStateError", "The cursor is being iterated or has iterated past its end.");
}

class IDBCursor {
  #it: any;

  constructor(key: unknown = undefined, it?: object) {
    idl.illegal(key);
    this.#it = it;
  }

  static {
    cursorState = cursor => cursor.#it;
  }

  get source() {
    return this.#it.source;
  }
  get direction() {
    return this.#it.direction;
  }
  get key() {
    return this.#it.key;
  }
  get primaryKey() {
    return this.#it.primaryKey;
  }
  get request() {
    return this.#it.request;
  }

  #check(writes = false): State {
    const { from } = this.#it;
    from.transaction.check(writes);
    requireExisting(from);
    return from;
  }

  #requirePast(target: string, current: string) {
    if (this.#it.direction[0] === "n" ? target > current : target < current) return;
    throw fail("DataError", "The parameter is not past this cursor's position.");
  }

  advance(count: number) {
    const it = this.#it;
    count = idl.inRange(count, 2 ** 32 - 1, 1);
    this.#check();
    requireValue(it);
    iterate(this, count);
  }

  continue(key: unknown = undefined) {
    const from = this.#check();
    requireValue(this.#it);
    const target = key === undefined ? key : encode(key);
    if (target !== undefined) this.#requirePast(target, keyOf(from, this.#it.entry));
    iterate(this, 1, target);
  }

  continuePrimaryKey(key: unknown, primaryKey: unknown) {
    const it = this.#it;
    need(arguments.length, 2);
    if (!this.#check().index || it.direction.endsWith("unique")) {
      throw fail("InvalidAccessError", "The source is not an index, or the direction is not 'next' or 'prev'.");
    }
    requireValue(it);
    const target = encode(key) + encode(primaryKey);
    this.#requirePast(target, it.entry);
    iterate(this, 1, target);
  }

  #writable() {
    const from = this.#check(true);
    requireValue(this.#it);
    if (!this.#it.hasValue) throw fail("InvalidStateError", "The cursor is a key cursor.");
    return primaryOf(from, this.#it.entry);
  }

  update(value: unknown) {
    const { from } = this.#it;
    need(arguments.length, 1);
    const primary = this.#writable();
    if (from.store.keyPath === null) return storeRecord(this, from, value, decode(primary), true);
    return storeRecord(this, from, value, undefined, true, primary);
  }

  delete() {
    const primary = this.#writable();
    const { transaction, store } = this.#it.from;
    const indexes = Object.values(store.indexes);
    return transaction.request(this, () => {
      const keys = transaction.backend.keys(store.table);
      if (keys[lowerBound(keys, primary)] === primary) removeRecord(transaction, store, indexes, primary);
    });
  }
}

class IDBCursorWithValue extends IDBCursor {}
idl.attribute(IDBCursorWithValue, "value", cursor => cursorState(cursor).value);

function openCursor(Cursor: typeof IDBCursor, source: object, from: State, query: unknown, direction: string) {
  direction = idl.oneOf(direction, directions);
  const { transaction } = checked(from);
  const range = bounds(query);
  const request = new IDBRequest(internal, source, transaction.handle);
  iterate(new Cursor(internal, { source, from, direction, request, range, hasValue: Cursor !== IDBCursor }), 1);
  return request;
}

function iterate(cursor: IDBCursor, count: number, target?: string) {
  const state = cursorState(cursor);
  const { source, from, direction, request, range } = state;
  const forward = direction.startsWith("next");
  const unique = direction.endsWith("unique");
  state.ready = false;
  stateOf(request).done = false;
  const run = () => {
    const entries = entriesOf(from);
    let entry: string | undefined = state.entry;
    for (; count > 0; count--) {
      if (forward) {
        const after = entry === undefined ? range[0] : (unique ? keyOf(from, entry) : entry) + PAST;
        entry = entries[lowerBound(entries, target ?? after)];
      } else {
        const before = entry === undefined ? range[1] : unique ? keyOf(from, entry) : entry;
        entry = entries[lowerBound(entries, target === undefined ? before : target + PAST) - 1];
        if (unique && entry !== undefined) entry = entries[lowerBound(entries, keyOf(from, entry))];
      }
      if (entry === undefined || entry < range[0] || entry >= range[1]) {
        state.key = state.primaryKey = state.value = undefined;
        return null;
      }
    }
    state.entry = entry;
    state.key = decode(entry!);
    state.primaryKey = readKey(from, entry!);
    if (state.hasValue) state.value = readValue(from, entry!);
    state.ready = true;
    return cursor;
  };
  from.transaction.request(source, run, request);
}

class IDBTransaction extends EventTarget {
  #transaction: Transaction;

  constructor(key: unknown = undefined, transaction?: Transaction) {
    idl.illegal(key);
    super();
    this.#transaction = transaction!;
  }

  get objectStoreNames() {
    const { mode, scope, connection } = this.#transaction;
    return names(mode === "versionchange" ? connection.storeNames() : scope);
  }
  get mode() {
    return this.#transaction.mode;
  }
  get durability() {
    return this.#transaction.durability;
  }
  get db() {
    return this.#transaction.connection.handle;
  }
  get error() {
    return this.#transaction.error;
  }

  objectStore(name: string) {
    const transaction = this.#transaction;
    need(arguments.length, 1);
    name = `${name}`;
    if (transaction.finished) throw fail("InvalidStateError", "The transaction has finished.");
    const store = transaction.backend.meta.stores[name];
    if (!store || (transaction.mode !== "versionchange" && !transaction.scope.includes(name))) {
      throw fail("NotFoundError", "The specified object store was not found.");
    }
    let handle = transaction.stores.$get(store);
    if (!handle) {
      handle = new IDBObjectStore(internal, { transaction, store, name, keyPath: ownKeyPath(store.keyPath) });
      transaction.stores.$set(store, handle);
    }
    return handle;
  }

  commit() {
    if (!this.#transaction.active) throw fail("InvalidStateError", "The transaction is not active.");
    this.#transaction.commit();
  }

  abort() {
    const transaction = this.#transaction;
    if (transaction.finished || transaction.committing)
      throw fail("InvalidStateError", "The transaction has finished.");
    transaction.abort(null);
  }
}
defineHandlers(IDBTransaction.prototype, ["abort", "complete", "error"]);

class Connection {
  handle = new IDBDatabase(internal, this);
  closed = false;
  upgrade: Transaction | undefined;
  version: number;
  #lastNames: string[] | undefined;

  constructor(
    readonly backend: any,
    readonly name: string,
  ) {
    this.version = backend.meta.version;
    backend.connections.add(this);
    connections.$add(this);
  }

  storeNames() {
    return this.#lastNames ?? Object.keys(this.backend.meta.stores);
  }

  close() {
    this.closed = true;
    if (!this.upgrade) this.#lastNames ??= this.storeNames();
    this.backend.disconnect(this);
    connections.$delete(this);
  }

  /** Called by another page, too. */
  versionChange(newVersion: number | null) {
    later(() => {
      const init = { oldVersion: this.version, newVersion };
      if (!this.closed) dispatchAlong(new IDBVersionChangeEvent("versionchange", init), this.handle);
    });
  }

  forceClose() {
    this.backend.abortTransactionsOf(this);
    this.close();
    later(() => idl.fire(this.handle, "close"));
  }
}

class IDBDatabase extends EventTarget {
  #connection: Connection;

  constructor(key: unknown = undefined, connection?: Connection) {
    idl.illegal(key);
    super();
    this.#connection = connection!;
  }

  get name() {
    return this.#connection.name;
  }
  get version() {
    return this.#connection.version;
  }
  get objectStoreNames() {
    return names(this.#connection.storeNames());
  }

  createObjectStore(name: string, options: unknown = undefined) {
    const connection = this.#connection;
    need(arguments.length, 1);
    name = `${name}`;
    const { autoIncrement, keyPath: given = null } = idl.dictionary(options);
    const keyPath = given === null ? null : toKeyPath(given);
    const transaction = upgrading(connection.upgrade);
    const { stores } = transaction.backend.meta;
    if (keyPath !== null) validateKeyPath(keyPath);
    if (name in stores) throw fail("ConstraintError", "An object store with the specified name already exists.");
    if (autoIncrement && (keyPath === "" || $isArray(keyPath))) {
      throw fail("InvalidAccessError", "The autoIncrement option was set but the key path is empty or an array.");
    }
    const table = transaction.backend.newTable();
    create(transaction, stores, name, {
      table,
      keyPath,
      autoIncrement: !!autoIncrement,
      nextKey: 1,
      indexes: { __proto__: null },
    });
    return transaction.handle.objectStore(name);
  }

  deleteObjectStore(name: string) {
    const connection = this.#connection;
    need(arguments.length, 1);
    name = `${name}`;
    remove(upgrading(connection.upgrade), connection.backend.meta.stores, name);
  }

  transaction(storeNames: any, mode = "readonly", options: unknown = undefined) {
    const connection = this.#connection;
    need(arguments.length, 1);
    const wanted = [...new Set<string>([toKeyPath(storeNames)].flat())];
    mode = idl.oneOf(mode, ["readonly", "readwrite", "versionchange"]);
    const durability = idl.oneOf(idl.dictionary(options).durability ?? "default", ["default", "strict", "relaxed"]);
    if (connection.upgrade) throw fail("InvalidStateError", "A version change transaction is running.");
    if (connection.closed) throw fail("InvalidStateError", "The database connection is closing.");
    if (wanted.some(name => !(name in connection.backend.meta.stores))) {
      throw fail("NotFoundError", "One of the specified object stores was not found.");
    }
    if (wanted.length === 0) throw fail("InvalidAccessError", "The storeNames parameter was empty.");
    if (mode === "versionchange") throw new TypeError(`The mode provided ('${mode}') is not valid.`);
    const transaction = new Transaction(connection, wanted, mode, durability);
    transaction.deactivateAfterMicrotasks();
    return transaction.handle;
  }

  close() {
    this.#connection.close();
  }
}
defineHandlers(IDBDatabase.prototype, ["abort", "close", "error", "versionchange"]);

const connections = new Set<Connection>();
/** What lets the next request for a database go ahead. */
const turns = new Set<() => void>();
const used = new Set<any>();
scope.cleanups.add(() => {
  used.$forEach(backend => backend.discardTransactions());
  connections.$forEach(connection => connection.close());
  turns.$forEach(done => done());
});

function inTurn(name: string, run: (backend: any, done: () => void) => void) {
  const backend = scope.env.indexedDB(name);
  used.$add(backend);
  backend.takeTurn((next: () => void) => {
    if (scope.disposed) return next();
    const done = () => turns.$delete(done) && next();
    turns.$add(done);
    later(() => run(backend, done));
  });
}

function whenAlone(backend: any, request: IDBRequest, newVersion: number | null, run: () => void) {
  const oldVersion = backend.meta.version;
  for (const other of Array.from<any>(backend.connections)) other.versionChange(newVersion);
  later(() => {
    if (backend.connections.size > 0)
      dispatchAlong(new IDBVersionChangeEvent("blocked", { oldVersion, newVersion }), request);
    backend.whenUnused(() => later(run));
  });
}

function upgrade(connection: Connection, request: IDBRequest, newVersion: number, finish: (error?: unknown) => void) {
  const { backend, version: oldVersion } = connection;
  const transaction = (connection.upgrade = new Transaction(connection, [], "versionchange", "default"));
  created = new WeakSet();
  backend.meta.version = connection.version = newVersion;
  transaction.undoLast.push(() => (backend.meta.version = connection.version = oldVersion));
  transaction.onFinish = committed => {
    stateOf(request).transaction = null;
    if (committed && !connection.closed) return finish();
    connection.close();
    later(finish, fail("AbortError", "The version change transaction was aborted, or the connection was closed."));
  };
  stateOf(request).transaction = transaction.handle;
  settle(request, connection.handle);
  transaction.fire(new IDBVersionChangeEvent("upgradeneeded", { oldVersion, newVersion }), request);
}

class IDBFactory {
  constructor(key: unknown = undefined) {
    idl.illegal(key);
  }

  #check() {
    if (scope.disposed) throw fail("InvalidStateError", "The context is not active.");
    if (scope.env.origin === "null")
      throw fail("SecurityError", "Access to the Indexed Database API is denied in this context.");
  }

  open(name: string, version: any = undefined) {
    need(arguments.length, 1);
    name = `${name}`;
    if (version !== undefined) version = idl.inRange(version, undefined, 1);
    this.#check();
    const request = new IDBOpenDBRequest(internal);
    inTurn(name, (backend, done) => {
      const oldVersion = backend.meta.version;
      const newVersion = version ?? (oldVersion || 1);
      let connection: Connection | undefined;
      const finish = (error?: unknown) => {
        settle(request, error ? undefined : connection!.handle, error);
        dispatchAlong(error ? errorEvent() : new Event("success"), request);
        done();
      };
      if (newVersion < oldVersion) {
        return finish(
          fail(
            "VersionError",
            `The requested version (${newVersion}) is less than the existing version (${oldVersion}).`,
          ),
        );
      }
      if (newVersion > oldVersion) {
        return whenAlone(backend, request, newVersion, () =>
          upgrade((connection = new Connection(backend, name)), request, newVersion, finish),
        );
      }
      connection = new Connection(backend, name);
      finish();
    });
    return request;
  }

  deleteDatabase(name: string) {
    need(arguments.length, 1);
    name = `${name}`;
    this.#check();
    const request = new IDBOpenDBRequest(internal);
    inTurn(name, (backend, done) =>
      whenAlone(backend, request, null, () => {
        const oldVersion = backend.meta.version;
        backend.erase();
        settle(request, undefined);
        dispatchAlong(new IDBVersionChangeEvent("success", { oldVersion }), request);
        done();
      }),
    );
    return request;
  }

  async databases() {
    this.#check();
    return Array.from(scope.env.indexedDatabases(), ({ name, version }: any) => ({ name, version }));
  }

  cmp(first: unknown, second: unknown) {
    need(arguments.length, 2);
    const [a, b] = [encode(first), encode(second)];
    return a < b ? -1 : a > b ? 1 : 0;
  }
}

const interfaces = {
  IDBCursor,
  IDBCursorWithValue,
  IDBDatabase,
  IDBFactory,
  IDBIndex,
  IDBKeyRange,
  IDBObjectStore,
  IDBOpenDBRequest,
  IDBRecord,
  IDBRequest,
  IDBTransaction,
};
for (const it of Object.values(interfaces)) expose(it);

export default { ...interfaces, IDBVersionChangeEvent, indexedDB: new IDBFactory(internal) };
