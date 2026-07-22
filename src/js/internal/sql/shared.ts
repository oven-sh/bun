import type { Query as QueryType } from "./query";

const PublicArray = globalThis.Array;
const {
  Query,
  SQLQueryFlags,
  symbols: { _strings, _values },
} = require("internal/sql/query");

declare global {
  interface NumberConstructor {
    isSafeInteger(number: unknown): number is number;
    isNaN(number: number): boolean;
  }
}

type ArrayType =
  | "BOOLEAN"
  | "BYTEA"
  | "CHAR"
  | "NAME"
  | "TEXT"
  | "CHAR"
  | "VARCHAR"
  | "SMALLINT"
  | "INT2VECTOR"
  | "INTEGER"
  | "INT"
  | "BIGINT"
  | "REAL"
  | "DOUBLE PRECISION"
  | "NUMERIC"
  | "MONEY"
  | "OID"
  | "TID"
  | "XID"
  | "CID"
  | "JSON"
  | "JSONB"
  | "JSONPATH"
  | "XML"
  | "POINT"
  | "LSEG"
  | "PATH"
  | "BOX"
  | "POLYGON"
  | "LINE"
  | "CIRCLE"
  | "CIDR"
  | "MACADDR"
  | "INET"
  | "MACADDR8"
  | "DATE"
  | "TIME"
  | "TIMESTAMP"
  | "TIMESTAMPTZ"
  | "INTERVAL"
  | "TIMETZ"
  | "BIT"
  | "VARBIT"
  | "ACLITEM"
  | "PG_DATABASE"
  | (string & {});
export type { ArrayType, SQLArrayParameter, SQLResultArray };
class SQLArrayParameter {
  serializedValues: string;
  arrayType: ArrayType;
  constructor(serializedValues: string, arrayType: ArrayType) {
    this.serializedValues = serializedValues;
    this.arrayType = arrayType;
  }
  toString() {
    return this.serializedValues;
  }
  toJSON() {
    return this.serializedValues;
  }
}

class SQLResultArray<T> extends PublicArray<T> {
  public count!: number | null;
  public command!: string | null;
  public lastInsertRowid!: number | bigint | null;
  public affectedRows!: number | bigint | null;

  static [Symbol.toStringTag] = "SQLResults";

  constructor(values: T[] = []) {
    super(...values);

    // match postgres's result array, in this way for in will not list the
    // properties and .map will not return undefined command and count
    Object.defineProperties(this, {
      count: { value: null, writable: true },
      command: { value: null, writable: true },
      lastInsertRowid: { value: null, writable: true },
      affectedRows: { value: null, writable: true },
    });
  }

  static get [Symbol.species]() {
    return Array;
  }
}

function decodeIfValid(value: string | null): string | null {
  if (value) {
    return decodeURIComponent(value);
  }
  return null;
}

const enum SSLMode {
  disable = 0,
  prefer = 1,
  require = 2,
  verify_ca = 3,
  verify_full = 4,
}
export type { SSLMode };

function normalizeSSLMode(value: string): SSLMode {
  if (!value) {
    return SSLMode.disable;
  }

  value = (value + "").toLowerCase();
  switch (value) {
    case "disable":
      return SSLMode.disable;
    case "prefer":
      return SSLMode.prefer;
    case "require":
    case "required":
      return SSLMode.require;
    case "verify-ca":
    case "verify_ca":
      return SSLMode.verify_ca;
    case "verify-full":
    case "verify_full":
      return SSLMode.verify_full;
    default: {
      break;
    }
  }

  throw $ERR_INVALID_ARG_VALUE("sslmode", value, "must be one of: disable, prefer, require, verify-ca, verify-full");
}

export type { SQLHelper };
class SQLHelper<T> {
  public readonly value: T;
  public readonly columns: (keyof T)[];

  constructor(value: T, keys?: (keyof T)[]) {
    if (keys !== undefined && keys.length === 0 && ($isObject(value[0]) || $isArray(value[0]))) {
      keys = Object.keys(value[0]) as (keyof T)[];
    }

    if (keys !== undefined) {
      for (let key of keys) {
        if (typeof key === "string") {
          const asNumber = Number(key);
          if (Number.isNaN(asNumber)) {
            continue;
          }
          key = asNumber as keyof T;
        }

        if (typeof key !== "string") {
          if (Number.isSafeInteger(key)) {
            if (key >= 0 && key <= 64 * 1024) {
              continue;
            }
          }

          throw new Error(`Keys must be strings or numbers: ${String(key)}`);
        }
      }
    }

    this.value = value;
    this.columns = keys ?? [];
  }
}

/**
 * Build the column list for INSERT statements while determining which columns have defined values.
 * This combines column name generation with defined column detection in a single pass.
 * Returns the defined columns array and the SQL fragment for the column names.
 */
function buildDefinedColumnsAndQuery<T>(
  columns: (keyof T)[],
  items: T | T[],
  escapeIdentifier: (name: string) => string,
): { definedColumns: (keyof T)[]; columnsSql: string } {
  const definedColumns: (keyof T)[] = [];
  let columnsSql = "(";
  const columnCount = columns.length;

  if ($isArray(items)) {
    for (let j = 0; j < items.length; j++) {
      if (items[j] == null) {
        throw new SyntaxError("Cannot use null or undefined as an item in INSERT helper");
      }
    }
  }

  for (let k = 0; k < columnCount; k++) {
    const column = columns[k];

    // Check if any item has this column defined
    let hasDefinedValue = false;
    if ($isArray(items)) {
      for (let j = 0; j < items.length; j++) {
        if (typeof items[j][column] !== "undefined") {
          hasDefinedValue = true;
          break;
        }
      }
    } else {
      hasDefinedValue = typeof items[column] !== "undefined";
    }

    if (hasDefinedValue) {
      if (definedColumns.length > 0) columnsSql += ", ";
      columnsSql += escapeIdentifier(column as string);
      definedColumns.push(column);
    }
  }

  columnsSql += ") VALUES";
  return { definedColumns, columnsSql };
}

const enum SQLCommand {
  insert = 0,
  update = 1,
  updateSet = 2,
  where = 3,
  in = 4,
  none = -1,
}
export type { SQLCommand };

function commandToString(command: SQLCommand): string {
  switch (command) {
    case SQLCommand.insert:
      return "INSERT";
    case SQLCommand.updateSet:
    case SQLCommand.update:
      return "UPDATE";
    case SQLCommand.in:
    case SQLCommand.where:
      return "WHERE";
    default:
      return "";
  }
}

function detectCommand(query: string, anyAndAllMeanIn: boolean): SQLCommand {
  const text = query.toLowerCase().trim();
  const text_len = text.length;

  let token = "";
  let command = SQLCommand.none;
  let quoted = false;
  // we need to reverse search so we find the closest command to the parameter
  for (let i = text_len - 1; i >= 0; i--) {
    const char = text[i];
    switch (char) {
      case " ": // Space
      case "\n": // Line feed
      case "\t": // Tab character
      case "\r": // Carriage return
      case "\f": // Form feed
      case "\v": {
        switch (token) {
          case "insert": {
            return SQLCommand.insert;
          }
          case "update": {
            return SQLCommand.update;
          }
          case "where": {
            return SQLCommand.where;
          }
          case "set": {
            return SQLCommand.updateSet;
          }
          case "in": {
            return SQLCommand.in;
          }
          default: {
            token = "";
            continue;
          }
        }
      }
      default: {
        // skip quoted commands
        if (char === '"') {
          quoted = !quoted;
          continue;
        }
        if (!quoted) {
          token = char + token;
        }
      }
    }
  }
  if (token) {
    switch (token) {
      case "insert":
        return SQLCommand.insert;
      case "update":
        return SQLCommand.update;
      case "where":
        return SQLCommand.where;
      case "set":
        return SQLCommand.updateSet;
      case "in":
        return SQLCommand.in;
      case "any":
      case "all":
        // MySQL treats a leading ANY/ALL token like IN; Postgres does not.
        return anyAndAllMeanIn ? SQLCommand.in : SQLCommand.none;
      default:
        return SQLCommand.none;
    }
  }
  return command;
}

function getHelperCommandFromDetect(query: string, anyAndAllMeanIn: boolean): SQLCommand {
  const command = detectCommand(query, anyAndAllMeanIn);
  // only selectIn, insert, update, updateSet are allowed
  if (command === SQLCommand.none || command === SQLCommand.where) {
    throw new SyntaxError("Helpers are only allowed for INSERT, UPDATE and IN commands");
  }
  return command;
}

/**
 * The driver-specific hooks consumed by the shared {@link normalizeQuery}.
 * Methods stay on the adapter prototype so per-query cost is a monomorphic
 * method call.
 */
interface QueryNormalizationAdapter {
  escapeIdentifier(name: string): string;
  /** Returns the placeholder for the given 1-based binding index ("?" or "$N"). */
  placeholder(index: number): string;
  /** Pushes a plain bound value and returns its SQL fragment (always consumes one binding index). */
  bindParam(value: unknown, binding_values: unknown[], index: number): string;
  /** Detects the SQL command preceding a helper, throwing if helpers are not allowed there. */
  getHelperCommand(query: string): SQLCommand;
  /** Whether the UPDATE helper should omit the SET keyword (MySQL upsert). */
  isUpsertUpdate(query: string): boolean;
  throwIfUpdateEmpty(query: string, hasValues: boolean): void;
}

function pushBindParam(
  adapter: QueryNormalizationAdapter,
  value: unknown,
  binding_values: unknown[],
  index: number,
): string {
  if (typeof value === "undefined") {
    binding_values.push(null);
  } else {
    binding_values.push(value);
  }
  return adapter.placeholder(index) + " ";
}

// This function handles array values in single fields:
// - JSON/JSONB are the only field types that can be arrays themselves, so we serialize them
// - SQL array field types (e.g., INTEGER[], TEXT[]) require the sql.array() helper
// - All other types are handled natively
function normalizeQuery(
  adapter: QueryNormalizationAdapter,
  strings: string | TemplateStringsArray,
  values: unknown[],
  binding_idx = 1,
): [string, unknown[]] {
  if (typeof strings === "string") {
    // identifier or unsafe query
    return [strings, values || []];
  }

  if (!$isArray(strings)) {
    // we should not hit this path
    throw new SyntaxError("Invalid query: SQL Fragment cannot be executed or was misused");
  }

  const str_len = strings.length;
  if (str_len === 0) {
    return ["", []];
  }

  let binding_values: any[] = [];
  let query = "";

  for (let i = 0; i < str_len; i++) {
    const string = strings[i];

    if (typeof string === "string") {
      query += string;

      if (values.length > i) {
        const value = values[i];

        if (value instanceof Query) {
          const q = value as QueryType<any, any>;
          const [sub_query, sub_values] = normalizeQuery(adapter, q[_strings], q[_values], binding_idx);

          query += sub_query;
          for (let j = 0; j < sub_values.length; j++) {
            binding_values.push(sub_values[j]);
          }
          binding_idx += sub_values.length;
        } else if (value instanceof SQLHelper) {
          const command = adapter.getHelperCommand(query);
          const { columns, value: items } = value as SQLHelper<any>;
          const columnCount = columns.length;
          if (columnCount === 0 && command !== SQLCommand.in) {
            throw new SyntaxError(`Cannot ${commandToString(command)} with no columns`);
          }
          const lastColumnIndex = columns.length - 1;

          if (command === SQLCommand.insert) {
            //
            // insert into users ${sql(users)} or insert into users ${sql(user)}
            //

            // Build column list while determining which columns have at least one defined value
            const { definedColumns, columnsSql } = buildDefinedColumnsAndQuery(
              columns,
              items,
              adapter.escapeIdentifier.bind(adapter),
            );

            const definedColumnCount = definedColumns.length;
            if (definedColumnCount === 0) {
              throw new SyntaxError("Insert needs to have at least one column with a defined value");
            }
            const lastDefinedColumnIndex = definedColumnCount - 1;

            query += columnsSql;
            if ($isArray(items)) {
              const itemsCount = items.length;
              const lastItemIndex = itemsCount - 1;
              for (let j = 0; j < itemsCount; j++) {
                query += "(";
                const item = items[j];
                for (let k = 0; k < definedColumnCount; k++) {
                  const column = definedColumns[k];
                  const columnValue = item[column];
                  query += `${adapter.placeholder(binding_idx++)}${k < lastDefinedColumnIndex ? ", " : ""}`;
                  // If this item has undefined for a column that other items defined, use null
                  binding_values.push(typeof columnValue === "undefined" ? null : columnValue);
                }
                if (j < lastItemIndex) {
                  query += "),";
                } else {
                  query += ") "; // the user can add RETURNING * or RETURNING id
                }
              }
            } else {
              query += "(";
              const item = items;
              for (let j = 0; j < definedColumnCount; j++) {
                const column = definedColumns[j];
                const columnValue = item[column];
                query += `${adapter.placeholder(binding_idx++)}${j < lastDefinedColumnIndex ? ", " : ""}`;
                binding_values.push(columnValue);
              }
              query += ") "; // the user can add RETURNING * or RETURNING id
            }
          } else if (command === SQLCommand.in) {
            // SELECT * FROM users WHERE id IN (${sql([1, 2, 3])})
            if (!$isArray(items)) {
              throw new SyntaxError("An array of values is required for WHERE IN helper");
            }
            const itemsCount = items.length;
            const lastItemIndex = itemsCount - 1;
            query += "(";
            for (let j = 0; j < itemsCount; j++) {
              query += `${adapter.placeholder(binding_idx++)}${j < lastItemIndex ? ", " : ""}`;
              if (columnCount > 0) {
                // we must use a key from a object
                if (columnCount > 1) {
                  // we should not pass multiple columns here
                  throw new SyntaxError("Cannot use WHERE IN helper with multiple columns");
                }
                // SELECT * FROM users WHERE id IN (${sql(users, "id")})
                const value = items[j];
                if (typeof value === "undefined") {
                  binding_values.push(null);
                } else if (value === null) {
                  throw new SyntaxError("Cannot use null as an item in WHERE IN helper with a column");
                } else {
                  const value_from_key = value[columns[0]];

                  if (typeof value_from_key === "undefined") {
                    binding_values.push(null);
                  } else {
                    binding_values.push(value_from_key);
                  }
                }
              } else {
                const value = items[j];
                if (typeof value === "undefined") {
                  binding_values.push(null);
                } else {
                  binding_values.push(value);
                }
              }
            }
            query += ") "; // more conditions can be added after this
          } else {
            // UPDATE users SET ${sql({ name: "John", age: 31 })} WHERE id = 1
            let item;
            if ($isArray(items)) {
              if (items.length > 1) {
                throw new SyntaxError("Cannot use array of objects for UPDATE");
              }
              item = items[0];
            } else {
              item = items;
            }
            if (item == null) {
              throw new SyntaxError("Cannot use null or undefined as an item in UPDATE helper");
            }
            // no need to include SET if is updateSet or upsert
            if (command === SQLCommand.update && !adapter.isUpsertUpdate(query)) {
              query += " SET ";
            }
            let hasValues = false;
            for (let i = 0; i < columnCount; i++) {
              const column = columns[i];
              const columnValue = item[column];
              if (typeof columnValue === "undefined") {
                // skip undefined values, this is the expected behavior in JS
                continue;
              }
              hasValues = true;
              query += `${adapter.escapeIdentifier(column as string)} = ${adapter.placeholder(binding_idx++)}${i < lastColumnIndex ? ", " : ""}`;
              binding_values.push(columnValue);
            }
            if (query.endsWith(", ")) {
              // we got an undefined value at the end, lets remove the last comma
              query = query.substring(0, query.length - 2);
            }
            adapter.throwIfUpdateEmpty(query, hasValues);
            // the user can add where clause after this
            query += " ";
          }
        } else {
          query += adapter.bindParam(value, binding_values, binding_idx++);
        }
      }
    } else {
      throw new SyntaxError("Invalid query: SQL Fragment cannot be executed or was misused");
    }
  }

  return [query, binding_values];
}

const enum PooledConnectionState {
  pending = 0,
  connected = 1,
  closed = 2,
}

const enum PooledConnectionFlags {
  /// canBeConnected is used to indicate that at least one time we were able to connect to the database
  canBeConnected = 1 << 0,
  /// reserved is used to indicate that the connection is currently reserved
  reserved = 1 << 1,
  /// preReserved is used to indicate that the connection will be reserved in the future when queryCount drops to 0
  preReserved = 1 << 2,
}
export type { PooledConnectionState };

function onQueryFinish(this: BasePooledConnection, onClose: (err: Error) => void) {
  this.queries.delete(onClose);
  this.adapter.release(this);
}

abstract class BasePooledConnection<ConnectionHandle extends { close(): void; flush(): void } = any> {
  adapter: BaseSQLAdapter<any, any, any>;
  connection: ConnectionHandle | null = null;
  state: PooledConnectionState = PooledConnectionState.pending;
  storedError: Error | null = null;
  queries: Set<(err: Error) => void> = new Set();
  onFinish: ((err: Error | null) => void) | null = null;
  connectionInfo: Bun.SQL.__internal.DefinedPostgresOrMySQLOptions;
  flags: number = 0;
  /// queryCount is used to indicate the number of queries using the connection, if a connection is reserved or if its a transaction queryCount will be 1 independently of the number of queries
  queryCount: number = 0;
  /// when the current connect cycle started; 0 when not connecting. Connect
  /// failures (server not yet accepting connections) are retried until
  /// connectionTimeout elapses from this point.
  connectStartedAt: number = 0;
  connectAttempts: number = 0;
  retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    connectionInfo: Bun.SQL.__internal.DefinedPostgresOrMySQLOptions,
    adapter: BaseSQLAdapter<any, any, any>,
  ) {
    this.adapter = adapter;
    this.connectionInfo = connectionInfo;
    this.#beginConnecting();
  }

  /** Starts (or restarts) the driver-specific native connection. */
  protected abstract startConnection(): Promise<void>;
  /** Wraps a driver error options object into the driver's Error class. */
  protected abstract wrapError(error: any): Error;
  /** Whether the given error code is an authentication-style error that retrying cannot fix. */
  protected abstract isNonRetryableError(code: string | undefined): boolean;
  /**
   * Whether the error is a connect failure (the server accepted the
   * connection but closed it before the handshake completed) that a backoff
   * retry can fix.
   */
  protected abstract isConnectFailureError(err: Error | null): boolean;

  async #beginConnecting() {
    // a fresh connect cycle (not a backoff retry) starts the retry budget
    if (this.connectStartedAt === 0) {
      this.connectStartedAt = Date.now();
      this.connectAttempts = 0;
    }
    await this.startConnection();
    if (this.onFinish !== null) {
      // the pool was force-closed while the native handle was being created;
      // close it now so onClose fires and onFinish settles
      this.connection?.close();
    }
  }

  protected handleConnected(err: any) {
    if (err) {
      err = this.wrapError(err);
    }
    const connectionInfo = this.connectionInfo;
    try {
      // user code; a throw must not abort the pool bookkeeping below
      if (connectionInfo?.onconnect) {
        connectionInfo.onconnect(err);
      }
    } finally {
      this.storedError = err;
      if (!err) {
        this.connectStartedAt = 0;
        this.flags |= PooledConnectionFlags.canBeConnected;
      }
      this.state = err ? PooledConnectionState.closed : PooledConnectionState.connected;
      const onFinish = this.onFinish;
      if (onFinish) {
        this.queryCount = 0;
        this.flags &= ~PooledConnectionFlags.reserved;
        this.flags &= ~PooledConnectionFlags.preReserved;

        // pool is closed, lets finish the connection
        if (err) {
          onFinish(err);
        } else {
          this.connection?.close();
        }
      } else {
        this.adapter.release(this, true);
      }
    }
  }

  protected handleClose(err: any) {
    if (err) {
      err = this.wrapError(err);
    }
    this.connection = null;
    this.storedError = err;
    if (this.#shouldRetryConnecting(err)) {
      // The server is not accepting connections yet (e.g. still starting
      // up). Keep the slot pending and retry with backoff instead of
      // failing the queries that are waiting for a connection. The user's
      // onclose callback only fires when the slot actually closes.
      this.connectAttempts++;
      const delay = Math.min(20 * 2 ** this.connectAttempts, 1000);
      this.retryTimer = setTimeout(BasePooledConnection.#retryTimerFired, delay, this);
      return;
    }
    // this connect cycle is over; a later retry() starts a fresh one
    this.connectStartedAt = 0;
    this.#finishClose(err);
  }

  static #retryTimerFired(self: BasePooledConnection) {
    self.retryTimer = null;
    // conditions may have changed during the backoff (pool closing, waiters
    // gone, retry budget elapsed), so re-check before dialing
    if (self.#canKeepRetrying()) {
      self.#beginConnecting();
    } else {
      self.#finishClose(self.storedError);
    }
  }

  #shouldRetryConnecting(err: any): boolean {
    // connect failures come from the native layer as options objects that
    // wrapError turned into the driver's Error class with a typed code
    if (!this.isConnectFailureError(err)) {
      return false;
    }
    return this.#canKeepRetrying();
  }

  #canKeepRetrying(): boolean {
    if (this.adapter.closed || this.onFinish !== null) {
      return false;
    }
    // only retry while queries are actually waiting for a connection
    if (this.adapter.waitingQueue.length === 0 && this.adapter.reservedQueue.length === 0) {
      return false;
    }
    // an explicit connectionTimeout of 0 disables the connect timer, and with
    // it the retry budget
    const connectionTimeout = this.connectionInfo.connectionTimeout ?? 30 * 1000;
    if (connectionTimeout <= 0) {
      return false;
    }
    return this.connectStartedAt !== 0 && Date.now() - this.connectStartedAt < connectionTimeout;
  }

  /// Returns true if a scheduled connect retry was cancelled; in that case
  /// nothing is in flight and no onClose/onConnected callback will fire.
  cancelRetry(): boolean {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
      return true;
    }
    return false;
  }

  #finishClose(err: any) {
    const connectionInfo = this.connectionInfo;
    try {
      // user code; a throw must not abort the pool bookkeeping below
      if (connectionInfo?.onclose) {
        connectionInfo.onclose(err);
      }
    } finally {
      this.state = PooledConnectionState.closed;
      this.storedError = err;

      // remove from ready connections if its there
      this.adapter.readyConnections.delete(this);
      const queries = new Set(this.queries);
      this.queries?.clear?.();
      this.queryCount = 0;
      this.flags &= ~PooledConnectionFlags.reserved;

      // notify all queries that the connection is closed
      for (const onClose of queries) {
        onClose(err);
      }
      const onFinish = this.onFinish;
      if (onFinish) {
        onFinish(err);
      }

      this.adapter.release(this, true);
    }
  }

  onClose(onClose: (err: Error) => void) {
    this.queries.add(onClose);
  }

  bindQuery(query: QueryType<any, any>, onClose: (err: Error) => void) {
    this.queries.add(onClose);
    query.finally(onQueryFinish.bind(this, onClose));
  }

  protected doRetry() {
    if (this.adapter.closed) {
      return;
    }
    // reset error and state
    this.storedError = null;
    this.connectStartedAt = 0;
    this.state = PooledConnectionState.pending;
    // retry connection
    this.#beginConnecting();
  }
  close() {
    try {
      if (this.state === PooledConnectionState.connected) {
        this.connection?.close();
      }
    } catch {}
  }
  flush() {
    this.connection?.flush();
  }
  retry() {
    // if pool is closed, we can't retry
    if (this.adapter.closed) {
      return false;
    }
    // we need to reconnect
    // lets use a retry strategy

    // we can only retry if one day we are able to connect
    if (this.flags & PooledConnectionFlags.canBeConnected) {
      this.doRetry();
    } else if (this.isNonRetryableError((this.storedError as any)?.code)) {
      // we can't retry these are authentication errors
      return false;
    } else {
      // we can retry
      this.doRetry();
    }
    return true;
  }
}

function closeNT(onClose: (err: Error) => void, err: Error | null) {
  onClose(err as Error);
}

/**
 * Resolves the password (which may be a function and/or a promise) and calls
 * the driver's native createConnection with the normalized pool options.
 * Extra trailing arguments past `useUnnamedPreparedStatements` (MySQL's
 * `allowPublicKeyRetrieval`) are ignored by drivers that don't take them.
 */
async function createPooledConnectionHandle<ConnectionHandle>(
  nativeCreateConnection: (...args: any[]) => ConnectionHandle,
  options: Bun.SQL.__internal.DefinedPostgresOrMySQLOptions,
  onConnected: (err: Error | null, connection: ConnectionHandle) => void,
  onClose: (err: Error | null) => void,
): Promise<ConnectionHandle | null> {
  const {
    hostname,
    port,
    username,
    tls,
    query,
    database,
    sslMode,
    idleTimeout = 0,
    connectionTimeout = 30 * 1000,
    maxLifetime = 0,
    prepare = true,
    path,
    allowPublicKeyRetrieval = false,
  } = options;

  let password: Bun.MaybePromise<string> | string | undefined | (() => Bun.MaybePromise<string>) = options.password;

  try {
    if (typeof password === "function") {
      password = password();
    }

    if (password && $isPromise(password)) {
      password = await password;
    }

    return nativeCreateConnection(
      hostname,
      Number(port),
      username || "",
      password || "",
      database || "",
      // > The default value for sslmode is prefer. As is shown in the table, this
      // makes no sense from a security point of view, and it only promises
      // performance overhead if possible. It is only provided as the default for
      // backward compatibility, and is not recommended in secure deployments.
      sslMode || SSLMode.disable,
      tls || null,
      query || "",
      path || "",
      onConnected,
      onClose,
      idleTimeout,
      connectionTimeout,
      maxLifetime,
      !prepare,
      !!allowPublicKeyRetrieval,
    );
  } catch (e) {
    // defer so the callback never runs while the adapter is still filling
    // this.connections (it scans that array)
    process.nextTick(closeNT, onClose, e);
    return null;
  }
}

abstract class BaseSQLAdapter<PooledConnection extends BasePooledConnection, ConnectionHandle, QueryHandle>
  implements DatabaseAdapter<PooledConnection, ConnectionHandle, QueryHandle>
{
  public readonly connectionInfo: Bun.SQL.__internal.DefinedPostgresOrMySQLOptions;

  public readonly connections: PooledConnection[];
  public readonly readyConnections: Set<PooledConnection> = new Set();

  public waitingQueue: Array<(err: Error | null, result: any) => void> = [];
  public reservedQueue: Array<(err: Error | null, result: any) => void> = [];

  public poolStarted: boolean = false;
  public closed: boolean = false;
  public totalQueries: number = 0;
  public onAllQueriesFinished: (() => void) | null = null;

  constructor(connectionInfo: Bun.SQL.__internal.DefinedPostgresOrMySQLOptions) {
    this.connectionInfo = connectionInfo;
    // Slots are filled one at a time in connect()'s pool-start loop, and
    // createPooledConnection can synchronously run user code (for example a
    // function-valued `password`) that re-enters methods scanning this array,
    // so every scan must tolerate unassigned holes.
    this.connections = new Array(connectionInfo.max);
  }

  protected abstract createPooledConnection(): PooledConnection;
  abstract createQueryHandle(sql: string, values: unknown[], flags: number): QueryHandle;
  abstract array(values: any[], typeNameOrID?: number | ArrayType): SQLArrayParameter;
  abstract getTransactionCommands(options?: string): TransactionCommands;
  abstract getDistributedTransactionCommands(name: string): TransactionCommands | null;
  abstract getCommitDistributedSQL(name: string): string;
  abstract getRollbackDistributedSQL(name: string): string;
  abstract escapeIdentifier(name: string): string;
  abstract connectionClosedError(): Error;
  abstract acquisitionTimeoutError(ms: number, max: number): Error;
  abstract notTaggedCallError(): Error;
  abstract queryCancelledError(): Error;
  abstract invalidTransactionStateError(message: string): Error;
  abstract unsafeTransactionError(): Error;
  abstract getHelperCommand(query: string): SQLCommand;

  placeholder(_index: number): string {
    return "?";
  }

  bindParam(value: unknown, binding_values: unknown[], index: number): string {
    return pushBindParam(this, value, binding_values, index);
  }

  isUpsertUpdate(_query: string): boolean {
    return false;
  }

  throwIfUpdateEmpty(_query: string, hasValues: boolean): void {
    if (!hasValues) {
      throw new SyntaxError("Update needs to have at least one column");
    }
  }

  normalizeQuery(strings: string | TemplateStringsArray, values: unknown[], binding_idx = 1): [string, unknown[]] {
    return normalizeQuery(this, strings, values, binding_idx);
  }

  protected checkUnsafeTransaction(sql: string, flags: number) {
    if (!(flags & SQLQueryFlags.allowUnsafeTransaction)) {
      if (this.connectionInfo.max !== 1) {
        const upperCaseSqlString = sql.toUpperCase().trim();
        if (upperCaseSqlString.startsWith("BEGIN") || upperCaseSqlString.startsWith("START TRANSACTION")) {
          throw this.unsafeTransactionError();
        }
      }
    }
  }

  supportsReservedConnections() {
    return true;
  }

  getConnectionForQuery(pooledConnection: PooledConnection) {
    return pooledConnection.connection;
  }

  attachConnectionCloseHandler(connection: PooledConnection, handler: () => void): void {
    if (connection.onClose) {
      connection.onClose(handler);
    }
  }

  detachConnectionCloseHandler(connection: PooledConnection, handler: () => void): void {
    const queries = connection.queries;
    if (queries) {
      queries.delete(handler);
    }
  }

  validateTransactionOptions(options: string): { valid: boolean; error?: string } {
    // The string is interpolated into the BEGIN/START TRANSACTION statement, so refuse
    // anything that could terminate the statement or start a new one.
    if (!/^[A-Za-z ,]*$/.test(options)) {
      return {
        valid: false,
        error: "Transaction options can only contain letters, spaces, and commas.",
      };
    }
    return { valid: true };
  }

  validateDistributedTransactionName(name: string): { valid: boolean; error?: string } {
    if (typeof name !== "string") {
      return {
        valid: false,
        error: "Distributed transaction name must be a string.",
      };
    }
    if (name.indexOf("'") !== -1) {
      return {
        valid: false,
        error: "Distributed transaction name cannot contain single quotes.",
      };
    }
    return { valid: true };
  }

  maxDistribution() {
    if (!this.waitingQueue.length) return 0;
    const result = Math.ceil((this.waitingQueue.length + this.totalQueries) / this.connections.length);
    return result ? result : 1;
  }

  flushConcurrentQueries() {
    const maxDistribution = this.maxDistribution();
    if (maxDistribution === 0) {
      return;
    }

    while (true) {
      const nonReservedConnections = Array.from(this.readyConnections).filter(
        c => !(c.flags & PooledConnectionFlags.preReserved) && c.queryCount < maxDistribution,
      );
      if (nonReservedConnections.length === 0) {
        return;
      }
      const orderedConnections = nonReservedConnections.sort((a, b) => a.queryCount - b.queryCount);
      for (const connection of orderedConnections) {
        const pending = this.waitingQueue.shift();
        if (!pending) {
          return;
        }
        connection.queryCount++;
        this.totalQueries++;
        pending(null, connection);
      }
    }
  }

  release(connection: PooledConnection, connectingEvent: boolean = false) {
    if (!connectingEvent) {
      connection.queryCount--;
      this.totalQueries--;
    }
    const currentQueryCount = connection.queryCount;
    if (currentQueryCount == 0) {
      connection.flags &= ~PooledConnectionFlags.reserved;
      connection.flags &= ~PooledConnectionFlags.preReserved;
    }
    if (this.onAllQueriesFinished) {
      // we are waiting for all queries to finish, lets check if we can call it
      if (!this.hasPendingQueries()) {
        this.onAllQueriesFinished();
      }
    }

    if (connection.state !== PooledConnectionState.connected) {
      // connection is not ready
      const storedError = connection.storedError;
      if (storedError) {
        // this connection got a error but maybe we can wait for another

        if (this.hasConnectionsAvailable()) {
          return;
        }

        const waitingQueue = this.waitingQueue;
        const reservedQueue = this.reservedQueue;

        this.waitingQueue = [];
        this.reservedQueue = [];
        // we have no connections available so lets fails
        for (const pending of waitingQueue) {
          pending(storedError, connection);
        }
        for (const pending of reservedQueue) {
          pending(storedError, connection);
        }
        // draining the queues may have been the last pending work; a
        // graceful close() is waiting on this callback
        if (this.onAllQueriesFinished && !this.hasPendingQueries()) {
          this.onAllQueriesFinished();
        }
      }
      return;
    }

    if (currentQueryCount == 0) {
      // ok we can actually bind reserved queries to it
      const pendingReserved = this.reservedQueue.shift();
      if (pendingReserved) {
        connection.flags |= PooledConnectionFlags.reserved;
        connection.queryCount++;
        this.totalQueries++;
        // we have a connection waiting for a reserved connection lets prioritize it
        pendingReserved(connection.storedError, connection);
        return;
      }
    }
    this.readyConnections.add(connection);
    this.flushConcurrentQueries();
  }

  hasConnectionsAvailable() {
    if (this.readyConnections?.size > 0) return true;
    if (this.poolStarted) {
      const pollSize = this.connections.length;
      for (let i = 0; i < pollSize; i++) {
        const connection = this.connections[i];
        // The slot can still be an unassigned hole while the pool is starting
        // and a synchronous creation failure re-enters via release().
        if (connection && connection.state !== PooledConnectionState.closed) {
          // some connection is connecting or connected
          return true;
        }
      }
    }
    return false;
  }

  hasPendingQueries() {
    if (this.waitingQueue.length > 0 || this.reservedQueue.length > 0) return true;
    if (this.poolStarted) {
      return this.totalQueries > 0;
    }
    return false;
  }
  isConnected() {
    if (this.readyConnections.size > 0) {
      return true;
    }
    if (this.poolStarted) {
      const pollSize = this.connections.length;
      for (let i = 0; i < pollSize; i++) {
        const connection = this.connections[i];
        if (connection?.state === PooledConnectionState.connected) {
          return true;
        }
      }
    }
    return false;
  }
  flush() {
    if (this.closed) {
      return;
    }
    if (this.poolStarted) {
      const pollSize = this.connections.length;
      for (let i = 0; i < pollSize; i++) {
        const connection = this.connections[i];
        if (connection?.state === PooledConnectionState.connected) {
          connection.connection?.flush();
        }
      }
    }
  }

  async #close() {
    let pending;
    while ((pending = this.waitingQueue.shift())) {
      pending(this.connectionClosedError(), null);
    }
    while (this.reservedQueue.length > 0) {
      const pendingReserved = this.reservedQueue.shift();
      if (pendingReserved) {
        pendingReserved(this.connectionClosedError(), null);
      }
    }

    const promises: Array<Promise<any>> = [];

    if (this.poolStarted) {
      this.poolStarted = false;
      const pollSize = this.connections.length;
      for (let i = 0; i < pollSize; i++) {
        const connection = this.connections[i];
        switch (connection?.state) {
          case PooledConnectionState.pending:
          case PooledConnectionState.connected: {
            // cancelRetry only returns true while a connect retry is parked
            // in a backoff timer; nothing is in flight then, so there is no
            // onClose/onConnected to wait for
            if (connection.cancelRetry()) {
              connection.state = PooledConnectionState.closed;
              break;
            }
            const { promise, resolve } = Promise.withResolvers();
            connection.onFinish = resolve;
            promises.push(promise);
            connection.connection?.close();
            break;
          }
        }
        // clean connection reference
        // @ts-ignore
        this.connections[i] = null;
      }
    }

    this.readyConnections.clear();
    this.waitingQueue.length = 0;
    return Promise.all(promises);
  }

  async close(options?: { timeout?: number }): Promise<void> {
    if (this.closed) {
      return;
    }

    let timeout = options?.timeout;
    if (timeout) {
      timeout = Number(timeout);
      if (timeout > 2 ** 31 || timeout < 0 || timeout !== timeout) {
        throw $ERR_INVALID_ARG_VALUE("options.timeout", timeout, "must be a non-negative integer less than 2^31");
      }

      this.closed = true;
      if (timeout === 0 || !this.hasPendingQueries()) {
        // close immediately
        await this.#close();
        return;
      }

      const { promise, resolve } = Promise.withResolvers<void>();
      const timer = setTimeout(() => {
        // timeout is reached, lets close and probably fail some queries
        this.#close().finally(resolve);
      }, timeout * 1000);
      timer.unref(); // dont block the event loop

      this.onAllQueriesFinished = () => {
        clearTimeout(timer);
        // everything is closed, lets close the pool
        this.#close().finally(resolve);
      };

      return promise;
    } else {
      this.closed = true;
      if (!this.hasPendingQueries()) {
        // close immediately
        await this.#close();
        return;
      }

      // gracefully close the pool
      const { promise, resolve } = Promise.withResolvers<void>();

      this.onAllQueriesFinished = () => {
        // everything is closed, lets close the pool
        this.#close().finally(resolve);
      };

      return promise;
    }
  }

  /**
   * @param {function} onConnected - The callback function to be called when the connection is established.
   * @param {boolean} reserved - Whether the connection is reserved, if is reserved the connection will not be released until release is called, if not release will only decrement the queryCount counter
   */
  connect(onConnected: (err: Error | null, result: any) => void, reserved: boolean = false) {
    if (this.closed) {
      return onConnected(this.connectionClosedError(), null);
    }

    // connectionTimeout bounds the total time to obtain a usable connection,
    // including waiting for a free pool slot. Without this, a pool whose slots
    // are all reserved (or leaked) leaves every later caller pending forever.
    const connectionTimeout = this.connectionInfo.connectionTimeout ?? 30 * 1000;
    if (connectionTimeout > 0) {
      const callback = onConnected;
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const wrapped = (err: Error | null, connection: any) => {
        if (settled) {
          // Timed out before the pool delivered this slot; don't leak it.
          if (!err && connection) this.release(connection);
          return;
        }
        settled = true;
        if (timer !== null) clearTimeout(timer);
        callback(err, connection);
      };
      const onAcquisitionTimeout = () => {
        timer = null;
        if (settled) return;
        // Only a pool with at least one established connection can be
        // "exhausted". If every slot is still connecting or closed, the
        // native connect timeout / retry budget owns the outcome and will
        // drain the queue with the underlying error. Re-arm so a slot that
        // connects after the first deadline still leaves this waiter bounded.
        if (!this.isConnected()) {
          timer = setTimeout(onAcquisitionTimeout, 100);
          return;
        }
        settled = true;
        let idx = this.waitingQueue.indexOf(wrapped);
        if (idx !== -1) this.waitingQueue.splice(idx, 1);
        else {
          idx = this.reservedQueue.indexOf(wrapped);
          if (idx !== -1) {
            this.reservedQueue.splice(idx, 1);
            // connect(_, true) may have marked a busy connection preReserved
            // for this waiter; with no reserved waiters left that hold is
            // unjustified and would keep flushConcurrentQueries() skipping it.
            if (this.reservedQueue.length === 0) {
              for (const c of this.connections) {
                if (c) c.flags &= ~PooledConnectionFlags.preReserved;
              }
            }
          }
        }
        callback(this.acquisitionTimeoutError(connectionTimeout, this.connections.length), null);
        if (this.onAllQueriesFinished && !this.hasPendingQueries()) {
          this.onAllQueriesFinished();
        }
      };
      timer = setTimeout(onAcquisitionTimeout, connectionTimeout);
      onConnected = wrapped;
    }

    if (this.readyConnections.size === 0) {
      // no connection ready lets make some
      let retry_in_progress = false;
      let all_closed = true;
      let storedError: Error | null = null;

      if (this.poolStarted) {
        // we already started the pool
        // lets check if some connection is available to retry
        const pollSize = this.connections.length;
        for (let i = 0; i < pollSize; i++) {
          const connection = this.connections[i];
          // we need a new connection and we have some connections that can retry
          // (an unassigned hole is a connection still being created, so it
          // lands in the "pending" branch below)
          if (connection?.state === PooledConnectionState.closed) {
            if (connection.retry()) {
              // lets wait for connection to be released
              if (!retry_in_progress) {
                // avoid adding to the queue twice, we wanna to retry every available pool connection
                retry_in_progress = true;
                if (reserved) {
                  // we are not sure what connection will be available so we dont pre reserve
                  this.reservedQueue.push(onConnected);
                } else {
                  this.waitingQueue.push(onConnected);
                }
              }
            } else {
              // we have some error, lets grab it and fail if unable to start a connection
              storedError = connection.storedError;
            }
          } else {
            // we have some pending or open connections
            all_closed = false;
          }
        }
        if (!all_closed && !retry_in_progress) {
          // is possible to connect because we have some working connections, or we are just without network for some reason
          // wait for connection to be released or fail
          if (reserved) {
            // we are not sure what connection will be available so we dont pre reserve
            this.reservedQueue.push(onConnected);
          } else {
            this.waitingQueue.push(onConnected);
          }
        } else if (!retry_in_progress) {
          // impossible to connect or retry
          onConnected(storedError ?? this.connectionClosedError(), null);
        }
        return;
      }
      // we never started the pool, lets start it
      if (reserved) {
        this.reservedQueue.push(onConnected);
      } else {
        this.waitingQueue.push(onConnected);
      }
      this.poolStarted = true;
      const pollSize = this.connections.length;
      // pool is always at least 1 connection
      const firstConnection = this.createPooledConnection();
      this.connections[0] = firstConnection;
      if (reserved) {
        firstConnection.flags |= PooledConnectionFlags.preReserved; // lets pre reserve the first connection
      }
      for (let i = 1; i < pollSize; i++) {
        this.connections[i] = this.createPooledConnection();
      }
      return;
    }
    if (reserved) {
      let connectionWithLeastQueries: PooledConnection | null = null;
      let leastQueries = Infinity;
      for (const connection of this.readyConnections) {
        if (connection.flags & PooledConnectionFlags.preReserved || connection.flags & PooledConnectionFlags.reserved)
          continue;
        const queryCount = connection.queryCount;
        if (queryCount > 0) {
          if (queryCount < leastQueries) {
            leastQueries = queryCount;
            connectionWithLeastQueries = connection;
          }
          continue;
        }
        connection.flags |= PooledConnectionFlags.reserved;
        connection.queryCount++;
        this.totalQueries++;
        this.readyConnections.delete(connection);
        onConnected(null, connection);
        return;
      }

      if (connectionWithLeastQueries) {
        // lets mark the connection with the least queries as preReserved if any
        connectionWithLeastQueries.flags |= PooledConnectionFlags.preReserved;
      }

      // no connection available to be reserved lets wait for a connection to be released
      this.reservedQueue.push(onConnected);
    } else {
      this.waitingQueue.push(onConnected);
      this.flushConcurrentQueries();
    }
  }
}

const SQLITE_MEMORY = ":memory:";
const SQLITE_MEMORY_VARIANTS: string[] = [":memory:", "sqlite://:memory:", "sqlite:memory"];

const sqliteProtocols = [
  { prefix: "sqlite://", stripLength: 9 },
  { prefix: "sqlite:", stripLength: 7 },
  { prefix: "file://", stripLength: -1 }, // Special case we can use Bun.fileURLToPath
  { prefix: "file:", stripLength: 5 },
];

function parseDefinitelySqliteUrl(value: string | URL | null): string | null {
  if (value === null) return null;
  const str = value instanceof URL ? value.toString() : value;

  if (SQLITE_MEMORY_VARIANTS.includes(str)) {
    return SQLITE_MEMORY;
  }

  for (const { prefix, stripLength } of sqliteProtocols) {
    if (!str.startsWith(prefix)) continue;

    if (stripLength === -1) {
      try {
        return Bun.fileURLToPath(str);
      } catch {
        // if it cant pass it's probably query string, we can just strip it
        // slicing off the file:// at the beginning
        return str.slice(7);
      }
    }

    return str.slice(stripLength);
  }

  // couldn't reliably determine this was definitely a sqlite url
  // it still *could* be, but not unambigously.
  return null;
}

function parseSQLiteOptions(
  filenameOrUrl: string | URL | null | undefined,
  options: Bun.SQL.__internal.OptionsWithDefinedAdapter,
): Bun.SQL.__internal.DefinedSQLiteOptions {
  // Start with base options
  const sqliteOptions: Bun.SQL.__internal.DefinedSQLiteOptions = {
    ...options,
    adapter: "sqlite" as const,
    filename: ":memory:",
  };

  let filename = filenameOrUrl || ":memory:";
  let originalUrl = filename; // Keep the original URL for query parsing

  if (filename instanceof URL) {
    originalUrl = filename.toString();
    filename = filename.toString();
  }

  let queryString: string | null = null;
  // Parse query string from the original URL before processing
  if (typeof originalUrl === "string") {
    const queryIndex = originalUrl.indexOf("?");
    if (queryIndex !== -1) {
      queryString = originalUrl.slice(queryIndex + 1);
      // Strip query from filename for processing
      if (typeof filename === "string") {
        filename = filename.slice(0, queryIndex);
      }
    }
  }

  // Now parse the filename (this handles file:// URLs and other protocols)
  const parsedFilename = parseDefinitelySqliteUrl(filename);
  if (parsedFilename !== null) {
    filename = parsedFilename;
  }

  // Empty filename defaults to :memory:
  sqliteOptions.filename = filename || ":memory:";

  // Parse query parameters if present
  if (queryString) {
    const params = new URLSearchParams(queryString);
    const mode = params.get("mode");

    if (mode === "ro") {
      sqliteOptions.readonly = true;
    } else if (mode === "rw") {
      sqliteOptions.readonly = false;
    } else if (mode === "rwc") {
      sqliteOptions.readonly = false;
      sqliteOptions.create = true;
    }
  }

  // Apply other SQLite-specific options
  if ("readonly" in options) {
    sqliteOptions.readonly = options.readonly;
  }
  if ("create" in options) {
    sqliteOptions.create = options.create;
  }
  if ("safeIntegers" in options) {
    sqliteOptions.safeIntegers = options.safeIntegers;
  }

  return sqliteOptions;
}

function isOptionsOfAdapter<A extends Bun.SQL.__internal.Adapter>(
  options: Bun.SQL.Options,
  adapter: A,
): options is Extract<Bun.SQL.Options, { adapter?: A }> {
  return options.adapter === adapter;
}

function assertIsOptionsOfAdapter<A extends Bun.SQL.__internal.Adapter>(
  options: Bun.SQL.Options,
  adapter: A,
): asserts options is Extract<Bun.SQL.Options, { adapter?: A }> {
  if (!isOptionsOfAdapter(options, adapter)) {
    throw new Error(`Expected adapter to be ${adapter}, but got '${options.adapter}'`);
  }
}

const DEFAULT_PROTOCOL: Bun.SQL.__internal.Adapter = "postgres";

const env = Bun.env;

/**
 * Reads environment variables to try and find a connnection string
 * @param adapter If an adapter is specified in the options, pass it here and
 * this function will only resolve from environment variables that are specific
 * to that adapter. Otherwise it will try them all.
 */
function getConnectionDetailsFromEnvironment(
  adapter: Bun.SQL.__internal.Adapter | undefined,
): [url: string | null, sslMode: SSLMode | null, adapter: Bun.SQL.__internal.Adapter | null] {
  let url: string | null = null;
  let sslMode: SSLMode.require | null = null;

  url ||= env.DATABASE_URL || env.DATABASEURL || null;
  if (!url) {
    url = env.TLS_DATABASE_URL || null;
    if (url) sslMode = SSLMode.require;
  }
  if (url) return [url, sslMode, adapter || null];

  if (!adapter || adapter === "postgres") {
    url ||= env.POSTGRES_URL || env.PGURL || env.PG_URL || env.PGURL || null;
    if (!url) {
      url = env.TLS_POSTGRES_DATABASE_URL || null;
      if (url) sslMode = SSLMode.require;
    }
    if (url) return [url, sslMode, "postgres"];
  }

  if (!adapter || adapter === "mysql") {
    url ||= env.MYSQL_URL || env.MYSQLURL || null;
    if (!url) {
      url = env.TLS_MYSQL_DATABASE_URL || null;
      if (url) sslMode = SSLMode.require;
    }
    if (url) return [url, sslMode, "mysql"];
  }

  if (!adapter || adapter === "mariadb") {
    url ||= env.MARIADB_URL || env.MARIADBURL || null;
    if (!url) {
      url = env.TLS_MARIADB_DATABASE_URL || null;
      if (url) sslMode = SSLMode.require;
    }
    if (url) return [url, sslMode, "mariadb"];
  }

  if (!adapter || adapter === "sqlite") {
    url ||= env.SQLITE_URL || env.SQLITEURL || null;
    // No TLS_ check because SQLite has no applicable sslMode
    if (url) return [url, sslMode, "sqlite"];
  }

  return [url, sslMode, adapter || null];
}

function ensureUrlHasProtocol<T extends string | URL>(
  url: T | null,
  protocol: string,
): (T extends string ? string : T extends URL ? URL : never) | null {
  if (url === null) return null;
  if (url instanceof URL) {
    url.protocol = protocol;
    return url as never;
  }
  return `${protocol}://${url}` as never;
}

function hasProtocol(url: string | URL): boolean {
  if (url instanceof URL) {
    return true;
  }

  return url.includes("://");
}

/**
 * @returns A tuple containing the parsed adapter (this is always correct) and a
 * url string, that you should continue to use for further options. In some
 * cases the it will be a parsed URL instance, and in others a string. This is
 * to save unnecessary parses in some cases. The third value is the SSL mode The last value is the options object
 * resolved from the possible overloads of the Bun.SQL constructor, it may have modifications
 */
function parseConnectionDetailsFromOptionsOrEnvironment(
  stringOrUrlOrOptions: Bun.SQL.Options | string | URL | undefined,
  definitelyOptionsButMaybeEmpty: Bun.SQL.Options,
): [url: string | URL | null, sslMode: SSLMode | null, options: Bun.SQL.__internal.OptionsWithDefinedAdapter] {
  // Step 1: Determine the options object and initial URL
  let options: Bun.SQL.Options;
  let stringOrUrl: string | URL | null = null;
  let sslMode: SSLMode | null = null;
  let adapter: Bun.SQL.__internal.Adapter | null = null;

  if (typeof stringOrUrlOrOptions === "string" || stringOrUrlOrOptions instanceof URL) {
    stringOrUrl = stringOrUrlOrOptions;
    options = definitelyOptionsButMaybeEmpty;
  } else {
    options = stringOrUrlOrOptions
      ? { ...stringOrUrlOrOptions, ...definitelyOptionsButMaybeEmpty }
      : definitelyOptionsButMaybeEmpty;
    [stringOrUrl, sslMode, adapter] = getConnectionDetailsFromEnvironment(options.adapter);
  }

  // Resolve URL based on adapter type
  let resolvedUrl: string | URL | null = stringOrUrl;

  let optionsFilename;
  let optionsUrl;
  if (options.adapter === "sqlite") {
    // SQLite adapter - only check filename (not url)
    if ("filename" in options && (optionsFilename = options.filename)) {
      resolvedUrl = optionsFilename;
    }
  } else if (!options.adapter) {
    // Unknown adapter - check both, filename first (more specific)
    if ("filename" in options && (optionsFilename = options.filename)) {
      resolvedUrl = optionsFilename;
    } else if ("url" in options && (optionsUrl = options.url)) {
      resolvedUrl = optionsUrl;
    }
  } else {
    // Known non-SQLite adapter - only check url (not filename)
    if ("url" in options && (optionsUrl = options.url)) {
      resolvedUrl = optionsUrl;
    }
  }

  if (options.adapter === "sqlite") {
    return [resolvedUrl, null, options as Bun.SQL.__internal.OptionsWithDefinedAdapter];
  }

  if (!options.adapter && resolvedUrl !== null) {
    const parsedPath = parseDefinitelySqliteUrl(resolvedUrl);

    if (parsedPath !== null) {
      // Return the original URL (with query params) for SQLite parsing
      return [resolvedUrl, null, { ...options, adapter: "sqlite" }];
    }
  }

  // Step 3: Parse protocol and ensure URL format for non-SQLite databases
  let protocol: Bun.SQL.__internal.Adapter | (string & {}) = options.adapter || DEFAULT_PROTOCOL;

  let urlToProcess = resolvedUrl || stringOrUrl;

  if (urlToProcess instanceof URL) {
    protocol = urlToProcess.protocol.replace(/:$/, "");
  } else if (urlToProcess !== null) {
    if (hasProtocol(urlToProcess)) {
      try {
        urlToProcess = new URL(urlToProcess);
        protocol = urlToProcess.protocol.replace(/:$/, "");
      } catch (e) {
        // options.adpater won't be sqlite here, we already did the special case check for it
        const optionsAdapter = options.adapter;
        if (optionsAdapter && typeof urlToProcess === "string" && urlToProcess.includes("sqlite")) {
          throw new Error(
            `Invalid URL '${urlToProcess}' for ${optionsAdapter}. Did you mean to specify \`{ adapter: "sqlite" }\`?`,
            { cause: e },
          );
        }

        // unrelated error to do with url parsing, we should re-throw. This is a real user error
        throw e;
      }
    } else {
      // Add protocol if missing
      urlToProcess = ensureUrlHasProtocol(urlToProcess, protocol);
    }
  }

  // Step 4: Set adapter from environment if not already set, but ONLY if not
  // already set (options object is highest priority)
  if (options.adapter === undefined && adapter !== null) {
    options.adapter = adapter;
  }

  // Step 5: Return early if adapter is explicitly specified
  const optionsAdapter = options.adapter;
  if (optionsAdapter) {
    // Validate that the adapter is supported
    const supportedAdapters = ["postgres", "sqlite", "mysql", "mariadb"];
    if (!supportedAdapters.includes(optionsAdapter)) {
      throw new Error(
        `Unsupported adapter: ${optionsAdapter}. Supported adapters: "postgres", "sqlite", "mysql", "mariadb"`,
      );
    }
    return [urlToProcess, sslMode, options as Bun.SQL.__internal.OptionsWithDefinedAdapter];
  }

  // Step 6: Infer adapter from protocol
  const parsedAdapterFromProtocol = parseAdapterFromProtocol(protocol);

  if (!parsedAdapterFromProtocol) {
    throw new Error(`Unsupported protocol: ${protocol}. Supported adapters: "postgres", "sqlite", "mysql", "mariadb"`);
  }

  return [urlToProcess, sslMode, { ...options, adapter: parsedAdapterFromProtocol }];
}

function parseAdapterFromProtocol(protocol: string): Bun.SQL.__internal.Adapter | null {
  switch (protocol) {
    case "http":
    case "https":
    case "ftp":
    case "postgres":
    case "postgresql":
      return "postgres";

    case "mysql":
    case "mysql2":
      return "mysql";

    case "mariadb":
      return "mariadb";

    case "file":
    case "sqlite":
      return "sqlite";

    default:
      return null;
  }
}

function parseOptions(
  stringOrUrlOrOptions: Bun.SQL.Options | string | URL | undefined,
  definitelyOptionsButMaybeEmpty: Bun.SQL.Options,
): Bun.SQL.__internal.DefinedOptions {
  const [_url, sslModeFromConnectionDetails, options] = parseConnectionDetailsFromOptionsOrEnvironment(
    stringOrUrlOrOptions,
    definitelyOptionsButMaybeEmpty,
  );

  const adapter = options.adapter;

  if (adapter === "sqlite") {
    return parseSQLiteOptions(_url, options);
  }

  // The rest of this function is logic specific to postgres/mysql/mariadb (they have the same options object)

  let sslMode: SSLMode = sslModeFromConnectionDetails || SSLMode.disable;

  let url = _url;

  let hostname: string | undefined;
  let port: number | string | undefined;
  let username: string | null | undefined;
  let password: string | (() => Bun.MaybePromise<string>) | undefined | null;
  let database: string | undefined;
  let tls: Bun.TLSOptions | boolean | undefined;
  let query: string = "";
  let idleTimeout: number | null | undefined;
  let connectionTimeout: number | null | undefined;
  let maxLifetime: number | null | undefined;
  let onconnect: ((error?: Error | undefined) => void) | undefined;
  let onclose: ((error?: Error | undefined) => void) | undefined;
  let max: number | null | undefined;
  let bigint: boolean | undefined;
  let path: string;
  let prepare: boolean = true;

  if (url !== null) {
    url = url instanceof URL ? url : new URL(url);
  }

  if (url) {
    // TODO(@alii): Move this logic into the switch statements below
    // options object is always higher priority
    hostname ||= options.host || options.hostname || url.hostname;
    port ||= options.port || url.port;
    username ||= options.user || options.username || decodeIfValid(url.username);
    password ||= options.pass || options.password || decodeIfValid(url.password);

    path ||= options.path || url.pathname;

    const queryObject = url.searchParams.toJSON();
    for (const key in queryObject) {
      if (key.toLowerCase() === "sslmode") {
        sslMode = normalizeSSLMode(queryObject[key]);
      } else if (key.toLowerCase() === "path") {
        path = queryObject[key];
      } else {
        // this is valid for postgres for other databases it might not be valid
        // check adapter then implement for other databases
        // encode string with \0 as finalizer
        // must be key\0value\0
        const value = `${queryObject[key]}`;
        if (key.includes("\0") || value.includes("\0")) {
          throw $ERR_INVALID_ARG_VALUE(`options.${key}`, queryObject[key], "must not contain null bytes");
        }
        query += `${key}\0${value}\0`;
      }
    }
    query = query.trim();
  }

  switch (adapter) {
    case "postgres": {
      hostname ||= options.hostname || options.host || env.PG_HOST || env.PGHOST || "localhost";
      break;
    }
    case "mysql": {
      hostname ||= options.hostname || options.host || env.MYSQL_HOST || env.MYSQLHOST || "localhost";
      break;
    }
    case "mariadb": {
      hostname ||= options.hostname || options.host || env.MARIADB_HOST || env.MARIADBHOST || "localhost";
      break;
    }
  }

  switch (adapter) {
    case "postgres": {
      port ||= Number(options.port || env.PG_PORT || env.PGPORT || "5432");
      break;
    }
    case "mysql": {
      port ||= Number(options.port || env.MYSQL_PORT || env.MYSQLPORT || "3306");
      break;
    }
    case "mariadb": {
      port ||= Number(options.port || env.MARIADB_PORT || env.MARIADBPORT || "3306");
      break;
    }
  }

  path ||= options.path || "";

  if (adapter === "postgres") {
    // add /.s.PGSQL.${port} if the unix domain socket is listening on that path
    if (path && Number.isSafeInteger(port) && path?.indexOf("/.s.PGSQL.") === -1) {
      const pathWithSocket = `${path}/.s.PGSQL.${port}`;

      // Only add the path if it actually exists. It would be better to just
      // always respect whatever the user passes in, but that would technically
      // be a breakpoint change at this point.
      if (require("node:fs").existsSync(pathWithSocket)) {
        path = pathWithSocket;
      }
    }
  }

  switch (adapter) {
    case "mysql": {
      username ||= options.username || options.user || env.MYSQL_USER || env.MYSQLUSER || env.USER || "root";
      break;
    }
    case "mariadb": {
      username ||= options.username || options.user || env.MARIADB_USER || env.MARIADBUSER || env.USER || "root";
      break;
    }
    case "postgres": {
      username ||= options.username || options.user || env.PG_USER || env.PGUSER || env.USER || "postgres";
      break;
    }
  }

  switch (adapter) {
    case "mysql": {
      password ||= options.password || options.pass || env.MYSQL_PASSWORD || env.MYSQLPASSWORD || env.PASSWORD || "";
      break;
    }

    case "mariadb": {
      password ||=
        options.password || options.pass || env.MARIADB_PASSWORD || env.MARIADBPASSWORD || env.PASSWORD || "";
      break;
    }

    case "postgres": {
      password ||= options.password || options.pass || env.PG_PASSWORD || env.PGPASSWORD || env.PASSWORD || "";
      break;
    }
  }

  switch (adapter) {
    case "postgres": {
      database ||=
        options.database ||
        options.db ||
        env.PG_DATABASE ||
        env.PGDATABASE ||
        decodeIfValid((url?.pathname ?? "").slice(1)) ||
        username;
      break;
    }

    case "mysql": {
      database ||=
        options.database ||
        options.db ||
        env.MYSQL_DATABASE ||
        env.MYSQLDATABASE ||
        decodeIfValid((url?.pathname ?? "").slice(1)) ||
        "mysql";
      break;
    }

    case "mariadb": {
      database ||=
        options.database ||
        options.db ||
        env.MARIADB_DATABASE ||
        env.MARIADBDATABASE ||
        decodeIfValid((url?.pathname ?? "").slice(1)) ||
        "mariadb";
      break;
    }
  }

  const connection = options.connection;
  if (connection && $isObject(connection)) {
    for (const key in connection) {
      if (connection[key] !== undefined) {
        const value = `${connection[key]}`;
        if (key.includes("\0") || value.includes("\0")) {
          throw $ERR_INVALID_ARG_VALUE(`options.connection.${key}`, connection[key], "must not contain null bytes");
        }
        query += `${key}\0${value}\0`;
      }
    }
  }

  tls ||= options.tls || options.ssl;
  max = options.max;

  idleTimeout ??= options.idleTimeout;
  idleTimeout ??= options.idle_timeout;
  connectionTimeout ??= options.connectionTimeout;
  connectionTimeout ??= options.connection_timeout;
  connectionTimeout ??= options.connectTimeout;
  connectionTimeout ??= options.connect_timeout;
  maxLifetime ??= options.maxLifetime;
  maxLifetime ??= options.max_lifetime;
  bigint ??= options.bigint;

  // we need to explicitly set prepare to false if it is false
  if (options.prepare === false) {
    if (adapter === "mysql") {
      throw $ERR_INVALID_ARG_VALUE("options.prepare", false, "prepared: false is not supported in MySQL");
    }
    prepare = false;
  }

  onconnect ??= options.onconnect;
  onclose ??= options.onclose;

  if (onconnect !== undefined) {
    if (!$isCallable(onconnect)) {
      throw $ERR_INVALID_ARG_TYPE("onconnect", "function", onconnect);
    }
  }

  if (onclose !== undefined) {
    if (!$isCallable(onclose)) {
      throw $ERR_INVALID_ARG_TYPE("onclose", "function", onclose);
    }
  }

  if (idleTimeout != null) {
    idleTimeout = Number(idleTimeout);
    if (idleTimeout > 2 ** 31 || idleTimeout < 0 || idleTimeout !== idleTimeout) {
      throw $ERR_INVALID_ARG_VALUE(
        "options.idle_timeout",
        idleTimeout,
        "must be a non-negative integer less than 2^31",
      );
    }
    idleTimeout *= 1000;
  }

  if (connectionTimeout != null) {
    connectionTimeout = Number(connectionTimeout);
    if (connectionTimeout > 2 ** 31 || connectionTimeout < 0 || connectionTimeout !== connectionTimeout) {
      throw $ERR_INVALID_ARG_VALUE(
        "options.connection_timeout",
        connectionTimeout,
        "must be a non-negative integer less than 2^31",
      );
    }
    connectionTimeout *= 1000;
  }

  if (maxLifetime != null) {
    maxLifetime = Number(maxLifetime);
    if (maxLifetime > 2 ** 31 || maxLifetime < 0 || maxLifetime !== maxLifetime) {
      throw $ERR_INVALID_ARG_VALUE(
        "options.max_lifetime",
        maxLifetime,
        "must be a non-negative integer less than 2^31",
      );
    }
    maxLifetime *= 1000;
  }

  if (max != null) {
    max = Number(max);
    if (max > 2 ** 31 || max < 1 || max !== max) {
      throw $ERR_INVALID_ARG_VALUE("options.max", max, "must be a non-negative integer between 1 and 2^31");
    }
  }

  if ($isObject(tls) && sslMode < SSLMode.verify_ca) {
    if (tls.rejectUnauthorized === true || (tls.rejectUnauthorized !== false && tls.ca)) {
      sslMode = SSLMode.verify_full;
    }
  }

  if (sslMode !== SSLMode.disable && !tls?.serverName) {
    if (hostname) {
      tls = { ...tls, serverName: hostname };
    } else if (tls) {
      tls = true;
    }
  }

  // Explicit tls/ssl options request an encrypted connection: if the server
  // declines TLS, the connection is aborted instead of continuing in plaintext.
  // Certificate verification is only enabled when explicitly requested
  // (ca, rejectUnauthorized, or a verify-* sslmode).
  if (tls && sslMode === SSLMode.disable) {
    sslMode = SSLMode.require;
  }

  port = Number(port);

  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw $ERR_INVALID_ARG_VALUE("port", port, "must be a non-negative integer between 1 and 65535");
  }

  const ret: Bun.SQL.__internal.DefinedOptions = {
    adapter,
    hostname,
    port,
    username,
    password,
    database,
    tls,
    prepare,
    allowPublicKeyRetrieval: options.allowPublicKeyRetrieval === true,
    bigint,
    sslMode,
    query,
    max: max || 10,
  };

  if (idleTimeout != null) {
    ret.idleTimeout = idleTimeout;
  }

  if (connectionTimeout != null) {
    ret.connectionTimeout = connectionTimeout;
  }

  if (maxLifetime != null) {
    ret.maxLifetime = maxLifetime;
  }

  if (onconnect !== undefined) {
    ret.onconnect = onconnect;
  }

  if (onclose !== undefined) {
    ret.onclose = onclose;
  }

  if (path) {
    if (require("node:fs").existsSync(path)) {
      ret.path = path;
    }
  }

  return ret;
}

export type OnConnected<Connection> = (
  ...args: [error: null, connection: Connection] | [error: Error, connection: null]
) => void;

export interface TransactionCommands {
  BEGIN: string;
  COMMIT: string;
  ROLLBACK: string;
  SAVEPOINT: string;
  RELEASE_SAVEPOINT: string | null;
  ROLLBACK_TO_SAVEPOINT: string;
  BEFORE_COMMIT_OR_ROLLBACK?: string | null;
}

export interface DatabaseAdapter<Connection, ConnectionHandle, QueryHandle> {
  normalizeQuery(strings: string | TemplateStringsArray, values: unknown[]): [sql: string, values: unknown[]];
  createQueryHandle(sql: string, values: unknown[], flags: number): QueryHandle;
  connect(onConnected: OnConnected<Connection>, reserved?: boolean): void;
  release(connection: Connection, connectingEvent?: boolean): void;
  close(options?: { timeout?: number }): Promise<void>;
  flush(): void;

  isConnected(): boolean;
  get closed(): boolean;

  supportsReservedConnections?(): boolean;
  getConnectionForQuery?(pooledConnection: Connection): ConnectionHandle | null;
  attachConnectionCloseHandler?(connection: Connection, handler: () => void): void;
  detachConnectionCloseHandler?(connection: Connection, handler: () => void): void;

  getTransactionCommands(options?: string): TransactionCommands;
  array(values: any[], typeNameOrID?: number | string): SQLArrayParameter;
  getDistributedTransactionCommands?(name: string): TransactionCommands | null;

  validateTransactionOptions?(options: string): { valid: boolean; error?: string };
  validateDistributedTransactionName?(name: string): { valid: boolean; error?: string };

  getCommitDistributedSQL?(name: string): string;
  getRollbackDistributedSQL?(name: string): string;
  escapeIdentifier(name: string): string;
  notTaggedCallError(): Error;
  connectionClosedError(): Error;
  queryCancelledError(): Error;
  invalidTransactionStateError(message: string): Error;
}

export default {
  parseDefinitelySqliteUrl,
  isOptionsOfAdapter,
  assertIsOptionsOfAdapter,
  parseOptions,
  SQLHelper,
  buildDefinedColumnsAndQuery,
  normalizeSSLMode,
  SQLResultArray,
  SQLArrayParameter,
  getHelperCommandFromDetect,
  pushBindParam,
  normalizeQuery,
  BasePooledConnection,
  BaseSQLAdapter,
  createPooledConnectionHandle,
  // @ts-expect-error we're exporting a const enum which works in our builtins
  // generator but not in typescript officially
  SSLMode,
};
