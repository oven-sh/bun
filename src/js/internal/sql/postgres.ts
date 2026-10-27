import type { NativeCreateConnection, NativeCreateQuery } from "./pool";
import type { Query } from "./query";
import type { ArrayType, SQLStatementDescription, TransactionCommands } from "./shared";

type SQLArrayParameter = import("./shared").SQLArrayParameter;
type SQLResultArray<T> = import("./shared").SQLResultArray<T>;

const { SQLResultArray, SQLArrayParameter } = require("internal/sql/shared");
const {
  BaseSQLAdapter,
  addResult,
  onRejectQuery,
  createPooledConnectionHandle,
  sameSettings,
  tryOtherPassword,
} = require("internal/sql/pool");
const {
  symbols: { _results, _handle, _copy },
} = require("internal/sql/query");

const { PostgresError } = require("internal/sql/errors");

const {
  createConnection: createPostgresConnection,
  createQuery: createPostgresQuery,
  init: initPostgres,
} = $bindgen("postgres.bind.ts", "binding") as PostgresDotZig;

// 1 to 4 are the commands whose tag counts the rows written.
const cmds = ["", "INSERT", "DELETE", "UPDATE", "MERGE", "SELECT", "MOVE", "FETCH", "COPY"];

const POSTGRES_ARRAY_TYPES = {
  // Boolean
  1000: "BOOLEAN", // bool_array

  // Binary
  1001: "BYTEA", // bytea_array

  // Character types
  1002: "CHAR", // char_array
  1003: "NAME", // name_array
  1009: "TEXT", // text_array
  1014: "CHAR", // bpchar_array
  1015: "VARCHAR", // varchar_array

  // Numeric types
  1005: "SMALLINT", // int2_array
  1006: "INT2VECTOR", // int2vector_array
  1007: "INTEGER", // int4_array
  1016: "BIGINT", // int8_array
  1021: "REAL", // float4_array
  1022: "DOUBLE PRECISION", // float8_array
  1231: "NUMERIC", // numeric_array
  791: "MONEY", // money_array

  // OID types
  1028: "OID", // oid_array
  1010: "TID", // tid_array
  1011: "XID", // xid_array
  1012: "CID", // cid_array

  // JSON types
  199: "JSON", // json_array
  3802: "JSONB", // jsonb (not array)
  3807: "JSONB", // jsonb_array
  4072: "JSONPATH", // jsonpath
  4073: "JSONPATH", // jsonpath_array

  // XML
  143: "XML", // xml_array

  // UUID
  2951: "UUID", // uuid_array

  // Geometric types
  1017: "POINT", // point_array
  1018: "LSEG", // lseg_array
  1019: "PATH", // path_array
  1020: "BOX", // box_array
  1027: "POLYGON", // polygon_array
  629: "LINE", // line_array
  719: "CIRCLE", // circle_array

  // Network types
  651: "CIDR", // cidr_array
  1040: "MACADDR", // macaddr_array
  1041: "INET", // inet_array
  775: "MACADDR8", // macaddr8_array

  // Date/Time types
  1182: "DATE", // date_array
  1183: "TIME", // time_array
  1115: "TIMESTAMP", // timestamp_array
  1185: "TIMESTAMPTZ", // timestamptz_array
  1187: "INTERVAL", // interval_array
  1270: "TIMETZ", // timetz_array

  // Bit string types
  1561: "BIT", // bit_array
  1563: "VARBIT", // varbit_array

  // ACL
  1034: "ACLITEM", // aclitem_array

  // System catalog types
  12052: "PG_DATABASE", // pg_database_array
  10052: "PG_DATABASE", // pg_database_array2
};

const enum ArrayKind {
  other = 0,
  json = 1,
  box = 2,
}

function arrayKind(type: ArrayType | undefined): ArrayKind {
  return type === "JSON" || type === "JSONB" ? ArrayKind.json : type === "BOX" ? ArrayKind.box : ArrayKind.other;
}

const arrayEscape = /[\\"]/g;
function quoteElement(text: string) {
  return '"' + text.replace(arrayEscape, "\\$&") + '"';
}

function hex(bytes: Buffer) {
  return quoteElement("\\x" + bytes.toString("hex"));
}

function jsonElement(value: unknown) {
  const text = typeof value === "bigint" ? String(value) : JSON.stringify(value);
  return text === undefined ? "NULL" : quoteElement(text);
}

// NULL is the only unquoted element: the server's input function for the element type reads the rest.
function arrayLiteral(values: ArrayLike<unknown>, kind: ArrayKind): string {
  const delimiter = kind === ArrayKind.box ? ";" : ",";
  let literal = "{";
  for (let i = 0, length = values.length; i < length; i++) {
    if (i > 0) literal += delimiter;
    const value = values[i];
    // null is a JSON value.
    if (value === undefined || (value === null && kind !== ArrayKind.json)) literal += "NULL";
    else if ($isArray(value)) literal += arrayLiteral(value, kind);
    else if (kind === ArrayKind.json) literal += jsonElement(value);
    else if (typeof value !== "object") literal += quoteElement(String(value));
    else if (value instanceof Date) literal += quoteElement(value.toISOString());
    else if (ArrayBuffer.isView(value)) literal += hex(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    else if (value instanceof ArrayBuffer || value instanceof SharedArrayBuffer) literal += hex(Buffer.from(value));
    else literal += jsonElement(value);
  }
  return literal + "}";
}

/// What `sql.json(value)` returns. The JSON text of `value` would be a string, which a json parameter stores as a JSON string.
class SQLJSONParameter {
  value: unknown;
  constructor(value: unknown) {
    this.value = value;
  }
  /// JSON.stringify() calls one toJSON(): this one, not that of a Date or a URL in `value`.
  toJSON(key: string) {
    const value = this.value;
    const toJSON = (value as { toJSON?: unknown } | null | undefined)?.toJSON;
    return $isCallable(toJSON) ? toJSON.$call(value, key) : value;
  }
}

function getArrayType(typeNameOrID: number | ArrayType | undefined): ArrayType | undefined {
  const typeOfType = typeof typeNameOrID;
  if (typeOfType === "number") {
    return POSTGRES_ARRAY_TYPES[typeNameOrID as number];
  }
  if (typeOfType === "string") {
    const type = (typeNameOrID as string).toUpperCase();
    // Allow `NUMERIC(10,2)`, `CHARACTER VARYING(255)`, `MYSCHEMA.MY_ENUM`,
    // `TIMESTAMP(3) WITH TIME ZONE`: identifier words separated by spaces or
    // dots, each optionally followed by a `(digits[,digits])` modifier.
    // Parentheses may only wrap digit lists so the value can never close the
    // enclosing expression and break out of the `$N::${type}[]` cast.
    if (
      !/^[A-Z_][A-Z0-9_]*(\( *[0-9]+( *, *[0-9]+)* *\))?([ .][A-Z_][A-Z0-9_]*(\( *[0-9]+( *, *[0-9]+)* *\))?)*$/.test(
        type,
      )
    ) {
      throw $ERR_INVALID_ARG_VALUE("type", typeNameOrID, "must be a valid PostgreSQL type name");
    }
    return type;
  }
  return undefined;
}

initPostgres(
  function onResolvePostgresQuery(query, result, commandTag, count, is_last, statement) {
    if (is_last) {
      query.resolve(query[_results]);
      return;
    }
    $assert(result instanceof SQLResultArray, "Invalid result array");
    // prepare for next query
    query[_handle].setPendingValue(new SQLResultArray());

    count ||= 0;
    if (typeof commandTag === "string") {
      if (commandTag.length > 0) {
        result.command = commandTag;
      }
      result.affectedRows = 0;
    } else {
      result.command = cmds[commandTag];
      result.affectedRows = commandTag >= 1 && commandTag <= 4 ? count : 0;
    }

    result.count = count;
    SQLResultArray.describe(result, query[_handle], statement);
    addResult(query, result);
  },
  onRejectQuery,
  arrayLiteral,
);

interface PostgresDotZig {
  init: (
    onResolveQuery: (
      query: Query<any, any>,
      result: SQLResultArray<unknown>,
      commandTag: string | number,
      count: number,
      is_last: boolean,
      statement: SQLStatementDescription | number | null,
    ) => void,
    onRejectQuery: (query: Query<any, any>, err: Error) => void,
    arrayLiteral: (values: ArrayLike<unknown>, kind: ArrayKind) => string,
  ) => void;
  createConnection: NativeCreateConnection<$Bindgen.PostgresSQLConnection>;
  createQuery: NativeCreateQuery<$Bindgen.PostgresSQLQuery>;
}

class PostgresAdapter extends BaseSQLAdapter<$Bindgen.PostgresSQLConnection, $Bindgen.PostgresSQLQuery> {
  readonly createNativeConnection = createPostgresConnection;
  protected readonly createNativeQuery = createPostgresQuery;
  readonly ErrorClass = PostgresError;
  readonly codePrefix = "ERR_POSTGRES_";
  protected readonly commitPrepared = "COMMIT PREPARED";
  protected readonly rollbackPrepared = "ROLLBACK PREPARED";

  array(values: any[], typeNameOrID?: number | ArrayType): SQLArrayParameter {
    const arrayType = getArrayType(typeNameOrID);
    return new SQLArrayParameter(
      $isArray(values) || $isTypedArrayView(values) ? arrayLiteral(values, arrayKind(arrayType)) : values,
      arrayType,
    );
  }

  json(value: unknown) {
    return new SQLJSONParameter(value);
  }

  getDistributedTransactionCommands(name: string): TransactionCommands | null {
    this.checkDistributedName(name);
    return { BEGIN: "BEGIN", COMMIT: `PREPARE TRANSACTION '${name}'`, ROLLBACK: "ROLLBACK" };
  }

  placeholder(index: number): string {
    return "$" + index;
  }

  copyStream(query: Query<any, any>, writable: boolean) {
    return writable
      ? new WritableStream(new CopySink(query))
      : new ReadableStream(new CopySource(query), new ByteLengthQueuingStrategy({ highWaterMark: 64 * 1024 }));
  }

  #listener: ListenConnection | null = null;

  listen(channel: string, onnotify: Listener, onlisten: OnListen | undefined): Promise<ListenSubscription> {
    if (this.closed) return Promise.$reject(this.connectionClosedError());
    return (this.#listener ??= ListenConnection.join(this)).listen(this, channel, onnotify, onlisten);
  }

  protected closeDedicatedConnections() {
    this.#listener?.leave(this);
    this.#listener = null;
  }
}

type Listener = (payload: string) => void;
type OnListen = () => void;
type ListenHandle = $Bindgen.PostgresSQLConnection;

/** Resolved from `sql.listen()`; removes the registration that call made. */
class ListenSubscription {
  readonly channel: string;
  #connection: ListenConnection | null;
  readonly #registered: Set<ListenSubscription>;
  readonly #onnotify: Listener;
  readonly #onlisten: OnListen | undefined;

  constructor(
    connection: ListenConnection,
    registered: Set<ListenSubscription>,
    channel: string,
    onnotify: Listener,
    onlisten: OnListen | undefined,
  ) {
    this.channel = channel;
    this.#connection = connection;
    this.#registered = registered.add(this);
    this.#onnotify = onnotify;
    this.#onlisten = onlisten;
  }

  unlisten(): Promise<void> {
    const connection = this.#connection;
    if (connection === null) return Promise.$resolve(undefined);
    this.#connection = null;
    this.#registered.delete(this);
    return connection.unsubscribe(this.channel, this.#onnotify, this.#onlisten);
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.unlisten();
  }
}

// One registration per listen() call (a callback may appear twice); the entry is deleted with its last one, so
// code resuming after an await compares its entry against the map to learn whether it is still the live one.
class Channel {
  // A lone listener is stored bare; arrays are replaced, never mutated, so a dispatch in progress is unaffected.
  listeners: Listener | readonly Listener[];
  onlisten: readonly OnListen[] | null = null;
  /** LISTEN round trip on the current connection; reset to null on disconnect. */
  ready: Promise<void> | null = null;

  constructor(listener: Listener) {
    this.listeners = listener;
  }

  add(listener: Listener) {
    const current = this.listeners;
    this.listeners = typeof current === "function" ? [current, listener] : [...current, listener];
  }

  /** @returns true when the channel has no registrations left */
  remove(listener: Listener): boolean {
    const current = this.listeners;
    if (typeof current === "function") return current === listener;
    const index = current.indexOf(listener);
    if (index !== -1) this.listeners = current.length === 2 ? current[1 - index] : current.toSpliced(index, 1);
    return false;
  }

  addOnlisten(callback: OnListen) {
    this.onlisten = this.onlisten === null ? [callback] : [...this.onlisten, callback];
  }

  removeOnlisten(callback: OnListen) {
    const current = this.onlisten;
    if (current === null) return;
    const index = current.indexOf(callback);
    if (index !== -1) this.onlisten = current.length === 1 ? null : current.toSpliced(index, 1);
  }

  fireOnlisten() {
    const callbacks = this.onlisten;
    if (callbacks === null) return;
    for (let i = 0; i < callbacks.length; i++) invoke(callbacks[i]);
  }
}

// A throwing callback is reported as uncaught; it must not skip the callbacks
// after it, reject listen(), or look like a failed LISTEN to #sweep.
function invoke(callback: () => void): void;
function invoke<T>(callback: (arg: T) => void, arg: T): void;
function invoke<T>(callback: (arg?: T) => void, arg?: T) {
  try {
    callback(arg);
  } catch (err) {
    reportError(err);
  }
}

// The members onResolvePostgresQuery and onRejectQuery read off a query.
class ListenQuery {
  resolve!: () => void;
  reject!: (err: unknown) => void;
  [_results] = null;
  [_handle]: $Bindgen.PostgresSQLQuery;

  constructor(handle: $Bindgen.PostgresSQLQuery) {
    this[_handle] = handle;
  }

  static run(conn: ListenHandle, sql: string): Promise<void> {
    const handle = createPostgresQuery(sql, [], new SQLResultArray(), false, true);
    const query = new ListenQuery(handle);
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    query.resolve = resolve;
    query.reject = reject;
    handle.run(conn, query as any);
    return promise;
  }
}

function quoteChannel(channel: string) {
  return '"' + channel.replaceAll('"', '""') + '"';
}

const RECONNECT_MIN_MS = 250;
const RECONNECT_MAX_MS = 32_000;

/// bun --hot only: the ones that are not closed.
const hotListeners = new Set<ListenConnection>();

// Every failure (connect error, drop, rejected LISTEN) is repaired by
// #scheduleSweep(): after a backoff, #sweep() re-issues LISTEN for each
// channel whose `ready` is null.
class ListenConnection {
  /// The one of `#pools` that joined last: it dials. It is closed when they all are.
  #adapter: PostgresAdapter;
  /// The pools that listen on it, each with its registrations. More than one under bun --hot only.
  readonly #pools = new Map<PostgresAdapter, Set<ListenSubscription>>();
  readonly #channels = new Map<string, Channel>();

  #conn: ListenHandle | null = null;
  #connecting: Promise<ListenHandle> | null = null;
  /** Mid-handshake handle, so #close() can abort it. */
  #handshake: ListenHandle | null = null;
  #sweepTimer: ReturnType<typeof setTimeout> | null = null;
  #backoffMs = RECONNECT_MIN_MS;

  constructor(adapter: PostgresAdapter) {
    this.#adapter = adapter;
    this.#pools.set(adapter, new Set());
  }

  /// Under bun --hot a pool listens on the connection of a pool with the same settings that an earlier load made.
  static join(adapter: PostgresAdapter): ListenConnection {
    if (adapter.generation === -1) {
      return new ListenConnection(adapter);
    }
    for (const listener of hotListeners) {
      const earlier = listener.#adapter;
      if (earlier.generation < adapter.generation && sameSettings(earlier, adapter)) {
        listener.#adapter = adapter;
        listener.#pools.set(adapter, new Set());
        return listener;
      }
    }
    const listener = new ListenConnection(adapter);
    hotListeners.add(listener);
    return listener;
  }

  leave(adapter: PostgresAdapter) {
    const pools = this.#pools;
    const registered = pools.get(adapter)!;
    pools.delete(adapter);
    if (pools.size === 0) {
      return this.#close();
    }
    if (this.#adapter === adapter) {
      this.#adapter = Array.from(pools.keys()).pop()!;
    }
    for (const subscription of registered) {
      subscription.unlisten();
    }
  }

  readonly #onNotification = (channel: string, payload: string) => {
    const entry = this.#channels.get(channel);
    if (entry === undefined) return;
    const listeners = entry.listeners;
    if (typeof listeners === "function") {
      listeners(payload); // nothing to shield from a throw; native reports it the same way
      return;
    }
    for (let i = 0; i < listeners.length; i++) invoke(listeners[i], payload);
  };

  async listen(
    adapter: PostgresAdapter,
    channel: string,
    onnotify: Listener,
    onlisten: OnListen | undefined,
  ): Promise<ListenSubscription> {
    let entry = this.#channels.get(channel);
    if (entry === undefined) {
      entry = new Channel(onnotify);
      this.#channels.set(channel, entry);
    } else {
      entry.add(onnotify);
    }
    const registered = this.#pools.get(adapter)!;
    const subscription = new ListenSubscription(this, registered, channel, onnotify, onlisten);

    try {
      await (entry.ready ??= this.#subscribe(channel, entry));
    } catch (err) {
      if (registered.delete(subscription) && this.#channels.get(channel) === entry) {
        if (entry.remove(onnotify)) {
          this.#channels.delete(channel);
          this.#closeIfIdle();
        } else {
          this.#scheduleSweep(); // the channel's other listeners lost this round trip too
        }
      }
      throw err;
    }

    // Nobody else has the subscription yet, so only close() of the pool can have ended it meanwhile.
    if (!registered.has(subscription) || this.#channels.get(channel) !== entry) throw adapter.connectionClosedError();
    if (onlisten !== undefined) {
      entry.addOnlisten(onlisten);
      invoke(onlisten);
    }
    return subscription;
  }

  async unsubscribe(channel: string, onnotify: Listener, onlisten: OnListen | undefined): Promise<void> {
    const entry = this.#channels.get(channel);
    if (entry === undefined) return;
    if (onlisten !== undefined) entry.removeOnlisten(onlisten);
    if (!entry.remove(onnotify)) return;

    this.#channels.delete(channel);
    if (this.#channels.size === 0) {
      this.#closeIfIdle();
      return;
    }
    const conn = this.#conn;
    if (conn === null) return;
    try {
      await ListenQuery.run(conn, "UNLISTEN " + quoteChannel(channel));
    } catch {
      // The connection dropped, which unsubscribed everything anyway.
    }
  }

  #close() {
    hotListeners.delete(this);
    this.#clearSweep();
    this.#channels.clear();
    const conn = this.#conn;
    const handshake = this.#handshake;
    this.#conn = this.#handshake = this.#connecting = null;
    conn?.close();
    handshake?.close();
  }

  async #subscribe(channel: string, entry: Channel): Promise<void> {
    try {
      const conn = await this.#connection();
      if (this.#channels.get(channel) !== entry) {
        this.#closeIfIdle();
        return;
      }
      await ListenQuery.run(conn, "LISTEN " + quoteChannel(channel));
      if (this.#channels.get(channel) !== entry) return;
      entry.fireOnlisten();
    } catch (err) {
      entry.ready = null;
      throw err;
    }
  }

  #connection(): Promise<ListenHandle> {
    if (this.#conn !== null) return Promise.$resolve(this.#conn);
    return (this.#connecting ??= this.#connect().finally(() => {
      this.#connecting = null;
    }));
  }

  #connect(login = { saslprep: this.#adapter.saslprep === true }): Promise<ListenHandle> {
    const adapter = this.#adapter;
    const { promise, resolve, reject } = Promise.withResolvers<ListenHandle>();
    let live: ListenHandle | null = null;

    adapter
      .runAsOwner(
        () =>
          createPooledConnectionHandle(
            createPostgresConnection,
            { ...adapter.connectionInfo, idleTimeout: 0, maxLifetime: 0 },
            adapter.ownerCallback((err, conn) => {
              this.#handshake = null;
              if (err) return reject(err);
              if (this.#adapter.closed) {
                conn.close();
                return reject(adapter.connectionClosedError());
              }
              live = this.#conn = conn;
              this.#backoffMs = RECONNECT_MIN_MS;
              conn.onnotification = this.#onNotification;
              conn.ref();
              resolve(conn);
              this.#clearSweep();
              this.#sweep();
              adapter.runUserCallback($getByIdDirect(adapter.connectionInfo, "onconnect"), null);
            }),
            adapter.ownerCallback(err => {
              err ??= adapter.connectionClosedError();
              if (live === null) {
                const handshake = this.#handshake;
                this.#handshake = null;
                return tryOtherPassword(login, err, handshake) ? resolve(this.#connect(login)) : reject(err);
              }
              if (this.#conn === live) {
                this.#conn = null;
                for (const entry of this.#channels.values()) entry.ready = null;
                this.#scheduleSweep();
              }
              adapter.runUserCallback($getByIdDirect(adapter.connectionInfo, "onclose"), err);
            }),
            undefined,
            login,
          ),
        undefined,
      )
      .then(handle => {
        if (handle === null || live !== null) return;
        if (this.#adapter.closed) handle.close();
        else this.#handshake = handle;
      }, reject);

    return promise;
  }

  #sweep() {
    if (this.#adapter.closed) return;
    let failed = false;
    let pending = 1; // released after the loop, so a sweep with nothing to do also settles
    const settle = () => {
      if (--pending !== 0) return;
      if (failed) this.#scheduleSweep();
      else this.#backoffMs = RECONNECT_MIN_MS;
    };
    for (const [channel, entry] of this.#channels) {
      if (entry.ready !== null) continue;
      pending++;
      (entry.ready = this.#subscribe(channel, entry)).then(settle, err => {
        failed = true;
        if (this.#channels.get(channel) === entry) {
          console.warn(`bun:sql LISTEN ${quoteChannel(channel)} failed, retrying: ${(err as Error)?.message ?? err}`);
        }
        settle();
      });
    }
    settle();
  }

  #scheduleSweep() {
    if (this.#sweepTimer !== null || this.#adapter.closed || this.#channels.size === 0) return;
    // Ref'd on purpose: while disconnected, this timer keeps the process alive.
    const delay = this.#backoffMs * (0.75 + Math.random() * 0.5);
    this.#backoffMs = Math.min(this.#backoffMs * 2, RECONNECT_MAX_MS);
    this.#sweepTimer = setTimeout(() => {
      this.#sweepTimer = null;
      this.#sweep();
    }, delay);
  }

  #clearSweep() {
    if (this.#sweepTimer !== null) {
      clearTimeout(this.#sweepTimer);
      this.#sweepTimer = null;
    }
  }

  // An in-flight handshake is left alone: the #subscribe awaiting it lands here.
  #closeIfIdle() {
    if (this.#channels.size !== 0) return;
    this.#clearSweep();
    this.#backoffMs = RECONNECT_MIN_MS;
    const conn = this.#conn;
    if (conn !== null) {
      this.#conn = null;
      conn.close();
    }
  }
}

// COPY. The native query calls `copy(chunk)` when the server enters copy mode, then with each chunk (TO STDOUT) or
// each time the socket has drained (FROM STDIN). The stream ends as the query does.

type CopyHandle = $Bindgen.PostgresSQLQuery;

function noop() {}

function notACopyError(method: string, direction: string) {
  return new PostgresError(`${method} needs a COPY ... ${direction} statement`, {
    code: "ERR_POSTGRES_COPY_NOT_SUPPORTED",
  });
}

class CopySource {
  query: Query<any, any>;
  handle: CopyHandle | null = null;
  started = false;
  controller: ReadableStreamDefaultController<Uint8Array> | null = null;

  constructor(query: Query<any, any>) {
    this.query = query;
    query[_copy] = this;
  }

  attach(handle: CopyHandle) {
    this.handle = handle;
    handle.setCopy(onCopyOut.bind(this), false);
  }

  start(controller: ReadableStreamDefaultController<Uint8Array>) {
    this.controller = controller;
    const query = this.query;
    query.$then(onCopyOutEnd.bind(this), onCopyOutError.bind(this));
    query.execute();
  }

  pull() {
    this.handle?.copyResume();
  }

  cancel() {
    this.controller = null;
    this.query.cancel();
  }

  /** The query is cancelled, or what it was made on ends. */
  abandon(why: string) {
    this.query.reject(new PostgresError("COPY to stdout failed: " + why, { code: "ERR_POSTGRES_QUERY_CANCELLED" }));
    this.query.cancel();
  }
}

/** @returns false when the socket is to be paused until pull() */
function onCopyOut(this: CopySource, chunk: Uint8Array | undefined) {
  if (chunk === undefined) {
    return (this.started = true);
  }
  const controller = this.controller;
  if (controller === null) {
    return true;
  }
  controller.enqueue(chunk);
  return controller.desiredSize! > 0;
}

function onCopyOutEnd(this: CopySource) {
  const controller = this.controller;
  if (controller === null) {
    return;
  }
  if (this.started) {
    controller.close();
  } else {
    controller.error(notACopyError("readable()", "TO STDOUT"));
  }
}

function onCopyOutError(this: CopySource, err: unknown) {
  const controller = this.controller;
  if (controller !== null) {
    this.controller = null;
    controller.error(err);
  }
}

class CopySink {
  query: Query<any, any>;
  handle: CopyHandle | null = null;
  controller: WritableStreamDefaultController | null = null;
  /** of start() until the server asks for the data, then of a write() that the socket has no room for */
  waiting: Promise<void> | null = null;
  /** what CopyFail says, once the stream has failed */
  failure: string | null = null;

  constructor(query: Query<any, any>) {
    this.query = query;
    query[_copy] = this;
  }

  attach(handle: CopyHandle) {
    this.handle = handle;
    handle.setCopy(onCopyIn.bind(this), true);
  }

  /** The query is cancelled, or what it was made on ends. CopyFail goes out now, or when the server asks for the data. */
  abandon(why: string) {
    this.failure ??= why;
    this.handle?.copyFail(why);
  }

  start(controller: WritableStreamDefaultController) {
    this.controller = controller;
    const query = this.query;
    query.$then(onCopyInEnd.bind(this), onCopyInError.bind(this));
    const waiting = (this.waiting = $newPromise<void>());
    query.execute();
    return waiting;
  }

  write(chunk: unknown) {
    try {
      if (this.handle!.copyWrite(chunk)) {
        return;
      }
    } catch (err) {
      // The stream calls nothing more, and the server would wait for ever.
      this.abort(err);
      throw err;
    }
    return (this.waiting = $newPromise<void>());
  }

  /** Settles with the query: the rows are in when the server has said so. */
  close() {
    this.handle!.copyDone();
    return this.query;
  }

  abort(reason: unknown) {
    let message = "aborted";
    try {
      if (reason !== undefined) message = String(reason);
    } catch {}
    this.abandon(message);
    return this.query.$then(noop, noop);
  }
}

function onCopyIn(this: CopySink) {
  const failure = this.failure;
  if (failure !== null) {
    return this.handle!.copyFail(failure);
  }
  const waiting = this.waiting;
  if (waiting !== null) {
    this.waiting = null;
    $resolvePromise(waiting, undefined);
  }
}

function onCopyInEnd(this: CopySink) {
  const waiting = this.waiting;
  if (waiting !== null) {
    this.waiting = null;
    $rejectPromise(waiting, notACopyError("writable()", "FROM STDIN"));
  }
}

function onCopyInError(this: CopySink, err: unknown) {
  const waiting = this.waiting;
  if (waiting !== null) {
    this.waiting = null;
    $rejectPromise(waiting, err);
  } else {
    this.controller!.error(err);
  }
}

export default {
  PostgresAdapter,
};
