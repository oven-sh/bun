const cmds = ["", "INSERT", "DELETE", "UPDATE", "MERGE", "SELECT", "MOVE", "FETCH", "COPY"];

const { hideFromStack } = require("internal/shared");
const defineProperties = Object.defineProperties;

const PublicArray = globalThis.Array;
const PublicPromise = globalThis.Promise;

enum SQLQueryResultMode {
  objects = 0,
  values = 1,
  raw = 2,
}

const enum QueryStatus {
  active = 1 << 1,
  cancelled = 1 << 2,
  error = 1 << 3,
  executed = 1 << 4,
  invalidHandle = 1 << 5,
}

function escapeIdentifier(str: string) {
  return '"' + str.replaceAll('"', '""').replaceAll(".", '"."') + '"';
}

function connectionClosedError() {
  return $ERR_POSTGRES_CONNECTION_CLOSED("Connection closed");
}
hideFromStack(connectionClosedError);

function notTaggedCallError() {
  return $ERR_POSTGRES_NOT_TAGGED_CALL("Query not called as a tagged template literal");
}
hideFromStack(notTaggedCallError);

class SQLResultArray extends PublicArray {
  static [Symbol.toStringTag] = "SQLResults";

  public command!: string | null;
  public count!: number | null;

  constructor() {
    super();
    // match postgres's result array, in this way for in will not list the properties and .map will not return undefined command and count
    Object.defineProperties(this, {
      count: { value: null, writable: true },
      command: { value: null, writable: true },
    });
  }

  static get [Symbol.species]() {
    return Array;
  }
}

namespace SQLite {
  let lazy_bunSqliteModule: (typeof import("./sqlite.ts"))["default"];
  export function getBunSqliteModule() {
    if (!lazy_bunSqliteModule) {
      lazy_bunSqliteModule = require("./sqlite.ts");
    }
    return lazy_bunSqliteModule;
  }
}

const _resolve = Symbol("resolve");
const _reject = Symbol("reject");
const _handle = Symbol("handle");
const _run = Symbol("run");
const _queryStatus = Symbol("status");
const _handler = Symbol("handler");
const _strings = Symbol("strings");
const _values = Symbol("values");
const _poolSize = Symbol("poolSize");
const _flags = Symbol("flags");
const _results = Symbol("results");
type TransactionCallback<T = any> = Bun.SQL.ContextCallback<T, Bun.SQL>;

const {
  createConnection: createPostgresConnection,
  createQuery: createPostgresQuery,
  init: initPostgres,
} = $zig("postgres.zig", "createBinding") as {
  init: (
    onResolveQuery: (
      query: Query<any>,
      result: SQLResultArray,
      commandTag: string,
      count: number,
      queries: any,
      is_last: boolean,
    ) => void,
    onRejectQuery: (query: Query<any>, err: Error, queries: any) => void,
  ) => void;
  createConnection: (
    hostname: string | undefined,
    port: number,
    username: string,
    password: string,
    databae: string,
    sslmode: Postgres.SSLMode,
    tls: Bun.TLSOptions | boolean | null, // boolean true => empty TLSOptions object `{}`, boolean false or null => nothing
    query: string,
    path: string,
    onConnected: (err: Error | null, connection: $ZigGeneratedClasses.PostgresSQLConnection) => void,
    onDisconnected: (err: Error | null, connection: $ZigGeneratedClasses.PostgresSQLConnection) => void,
    idleTimeout: number,
    connectionTimeout: number,
    maxLifetime: number,
    useUnnamedPreparedStatements: boolean,
  ) => $ZigGeneratedClasses.PostgresSQLConnection;
  createQuery: (
    sql: string,
    values: unknown[],
    pendingValue: SQLResultArray,
    columns: string[] | undefined,
    bigint: boolean,
    simple: boolean,
  ) => $ZigGeneratedClasses.PostgresSQLQuery;
};

enum SQLQueryFlags {
  none = 0,
  allowUnsafeTransaction = 1 << 0,
  unsafe = 1 << 1,
  bigint = 1 << 2,
  simple = 1 << 3,
  notTagged = 1 << 4,
}

enum SQLCommand {
  insert = 0,
  update = 1,
  updateSet = 2,
  where = 3,
  whereIn = 4,
  none = -1,
}

function commandToString(command: SQLCommand): string {
  switch (command) {
    case SQLCommand.insert:
      return "INSERT";
    case SQLCommand.updateSet:
    case SQLCommand.update:
      return "UPDATE";
    case SQLCommand.whereIn:
    case SQLCommand.where:
      return "WHERE";
    default:
      return "";
  }
}

function detectCommand(query: string): SQLCommand {
  const text = query.toLowerCase().trim();
  const text_len = text.length;

  let token = "";
  let command = SQLCommand.none;
  let quoted = false;
  for (let i = 0; i < text_len; i++) {
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
            if (command === SQLCommand.none) {
              return SQLCommand.insert;
            }
            return command;
          }
          case "update": {
            if (command === SQLCommand.none) {
              command = SQLCommand.update;
              token = "";
              continue; // try to find SET
            }
            return command;
          }
          case "where": {
            command = SQLCommand.where;
            token = "";
            continue; // try to find IN
          }
          case "set": {
            if (command === SQLCommand.update) {
              command = SQLCommand.updateSet;
              token = "";
              continue; // try to find WHERE
            }
            return command;
          }
          case "in": {
            if (command === SQLCommand.where) {
              return SQLCommand.whereIn;
            }
            return command;
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
          token += char;
        }
      }
    }
  }
  if (token) {
    switch (command) {
      case SQLCommand.none: {
        switch (token) {
          case "insert":
            return SQLCommand.insert;
          case "update":
            return SQLCommand.update;
          case "where":
            return SQLCommand.where;
          default:
            return SQLCommand.none;
        }
      }
      case SQLCommand.update: {
        if (token === "set") {
          return SQLCommand.updateSet;
        }
        return SQLCommand.update;
      }
      case SQLCommand.where: {
        if (token === "in") {
          return SQLCommand.whereIn;
        }
        return SQLCommand.where;
      }
    }
  }

  return command;
}

type OnConnected<Connection> = (
  ...args: [error: null, connection: Connection] | [error: Error, connection: null]
) => void;

interface DatabaseAdapter<Connection> {
  normalizeQuery(strings: string | TemplateStringsArray, values: unknown[]): [string, unknown[]];
  createQueryHandle(sqlString: string, values: unknown[], flags: number, poolSize: number): any;
  connect(onConnected: OnConnected<Connection>, reserved?: boolean): void;
  release(connection: Connection, connectingEvent?: boolean): void;
  close(options?: { timeout?: number }): Promise<void>;
  flush(): void;
  isConnected(): boolean;
  get closed(): boolean;
  reserve<T>(sql: any, onReserveConnected: (resolvers: PromiseWithResolvers<T>) => void): Promise<T>;
  getBeginCommand(options?: string, distributedName?: string): string;
  getCommitCommand(distributedName?: string): string;
  getRollbackCommand(distributedName?: string): string;
  getBeforeCommitOrRollbackCommand(distributedName?: string): string | null;
  supportsDistributedTransactions(): boolean;
  commitDistributed(name: string, sql: any): Promise<any>;
  rollbackDistributed(name: string, sql: any): Promise<any>;
}

/**
 * Get the display name for an adapter (e.g., "sqlite" -> "SQLite", "postgres" -> "PostgreSQL")
 */
function getAdapterDisplayName(
  optionsOrAdapter: Bun.SQL.__internal.DefinedOptions | Bun.SQL.__internal.DefinedOptions["adapter"],
): string {
  const adapter = typeof optionsOrAdapter === "string" ? optionsOrAdapter : optionsOrAdapter.adapter;

  switch (adapter) {
    case "sqlite":
      return "SQLite";
    case "postgres":
      return "PostgreSQL";
    default:
      adapter satisfies never;
      return "Unknown adapter";
  }
}

namespace Postgres {
  export function normalizeSSLMode(value: string): SSLMode {
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

    throw $ERR_INVALID_ARG_VALUE("sslmode", value);
  }

  export const enum SSLMode {
    disable = 0,
    prefer = 1,
    require = 2,
    verify_ca = 3,
    verify_full = 4,
  }

  export function normalizeQuery(
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
            const [sub_query, sub_values] = normalizeQuery(value[_strings], value[_values], binding_idx);
            query += sub_query;
            for (let j = 0; j < sub_values.length; j++) {
              binding_values.push(sub_values[j]);
            }
            binding_idx += sub_values.length;
          } else if (value instanceof SQLHelper) {
            const command = detectCommand(query);
            // only selectIn, insert, update, updateSet are allowed
            if (command === SQLCommand.none || command === SQLCommand.where) {
              throw new SyntaxError("Helpers are only allowed for INSERT, UPDATE and WHERE IN commands");
            }
            const { columns, value: items } = value as SQLHelper;
            const columnCount = columns.length;
            if (columnCount === 0 && command !== SQLCommand.whereIn) {
              throw new SyntaxError(`Cannot ${commandToString(command)} with no columns`);
            }
            const lastColumnIndex = columns.length - 1;

            if (command === SQLCommand.insert) {
              //
              // insert into users ${sql(users)} or insert into users ${sql(user)}
              //

              query += "(";
              for (let j = 0; j < columnCount; j++) {
                query += escapeIdentifier(columns[j]);
                if (j < lastColumnIndex) {
                  query += ", ";
                }
              }
              query += ") VALUES";
              if ($isArray(items)) {
                const itemsCount = items.length;
                const lastItemIndex = itemsCount - 1;
                for (let j = 0; j < itemsCount; j++) {
                  query += "(";
                  const item = items[j];
                  for (let k = 0; k < columnCount; k++) {
                    const column = columns[k];
                    const columnValue = item[column];
                    query += `$${binding_idx++}${k < lastColumnIndex ? ", " : ""}`;
                    if (typeof columnValue === "undefined") {
                      binding_values.push(null);
                    } else {
                      binding_values.push(columnValue);
                    }
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
                for (let j = 0; j < columnCount; j++) {
                  const column = columns[j];
                  const columnValue = item[column];
                  query += `$${binding_idx++}${j < lastColumnIndex ? ", " : ""}`;
                  if (typeof columnValue === "undefined") {
                    binding_values.push(null);
                  } else {
                    binding_values.push(columnValue);
                  }
                }
                query += ") "; // the user can add RETURNING * or RETURNING id
              }
            } else if (command === SQLCommand.whereIn) {
              // SELECT * FROM users WHERE id IN (${sql([1, 2, 3])})
              if (!$isArray(items)) {
                throw new SyntaxError("An array of values is required for WHERE IN helper");
              }
              const itemsCount = items.length;
              const lastItemIndex = itemsCount - 1;
              query += "(";
              for (let j = 0; j < itemsCount; j++) {
                query += `$${binding_idx++}${j < lastItemIndex ? ", " : ""}`;
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
              // no need to include if is updateSet
              if (command === SQLCommand.update) {
                query += " SET ";
              }
              for (let i = 0; i < columnCount; i++) {
                const column = columns[i];
                const columnValue = item[column];
                query += `${escapeIdentifier(column)} = $${binding_idx++}${i < lastColumnIndex ? ", " : ""}`;
                if (typeof columnValue === "undefined") {
                  binding_values.push(null);
                } else {
                  binding_values.push(columnValue);
                }
              }
              query += " "; // the user can add where clause after this
            }
          } else {
            //TODO: handle sql.array parameters
            query += `$${binding_idx++} `;
            if (typeof value === "undefined") {
              binding_values.push(null);
            } else {
              binding_values.push(value);
            }
          }
        }
      } else {
        throw new SyntaxError("Invalid query: SQL Fragment cannot be executed or was misused");
      }
    }

    return [query, binding_values];
  }

  export class PostgresConnectionPool {
    options: Bun.SQL.__internal.DefinedPostgresOptions;

    connections: Array<PooledPostgresConnection | null>;
    readyConnections: Set<PooledPostgresConnection>;
    waitingQueue: Array<(err: Error | null, result: any) => void> = [];
    reservedQueue: Array<(err: Error | null, result: any) => void> = [];

    poolStarted: boolean = false;
    closed: boolean = false;
    totalQueries: number = 0;
    onAllQueriesFinished: (() => void) | null = null;

    constructor(options: Bun.SQL.__internal.DefinedPostgresOptions) {
      this.options = options;
      this.connections = new Array<PooledPostgresConnection | null>(options.max);
      this.readyConnections = new Set();
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

    release(connection: PooledPostgresConnection, connectingEvent: boolean = false) {
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
        if (connection.storedError) {
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
            pending(connection.storedError, connection);
          }
          for (const pending of reservedQueue) {
            pending(connection.storedError, connection);
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
      if (this.readyConnections.size > 0) return true;
      if (this.poolStarted) {
        const pollSize = this.connections.length;
        for (let i = 0; i < pollSize; i++) {
          const connection = this.connections[i];
          if (!connection) {
            continue;
          }
          if (connection.state !== PooledConnectionState.closed) {
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
          if (!connection) {
            continue;
          }
          if (connection.state === PooledConnectionState.connected) {
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
          if (!connection) {
            continue;
          }
          if (connection.state === PooledConnectionState.connected) {
            connection.connection?.flush();
          }
        }
      }
    }

    async #close() {
      let pending;
      while ((pending = this.waitingQueue.shift())) {
        pending(connectionClosedError(), null);
      }
      while (this.reservedQueue.length > 0) {
        const pendingReserved = this.reservedQueue.shift();
        if (pendingReserved) {
          pendingReserved(connectionClosedError(), null);
        }
      }
      const promises: Array<Promise<any>> = [];
      if (this.poolStarted) {
        this.poolStarted = false;
        const pollSize = this.connections.length;
        for (let i = 0; i < pollSize; i++) {
          const connection = this.connections[i];
          if (!connection) {
            continue;
          }
          switch (connection.state) {
            case PooledConnectionState.pending:
              {
                const { promise, resolve } = Promise.withResolvers();
                connection.onFinish = resolve;
                promises.push(promise);
                connection.connection?.close();
              }
              break;
            case PooledConnectionState.connected:
              {
                const { promise, resolve } = Promise.withResolvers();
                connection.onFinish = resolve;
                promises.push(promise);
                connection.connection?.close();
              }
              break;
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
    async close(options?: { timeout?: number }) {
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

        const { promise, resolve } = Promise.withResolvers();
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
        const { promise, resolve } = Promise.withResolvers();
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
    connect(onConnected: OnConnected<PooledPostgresConnection>, reserved = false): void {
      if (this.closed) {
        return onConnected(connectionClosedError(), null);
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
            if (!connection) {
              continue;
            }
            // we need a new connection and we have some connections that can retry
            if (connection.state === PooledConnectionState.closed) {
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
            onConnected(storedError ?? connectionClosedError(), null);
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
        const firstConnection = new PooledPostgresConnection(this.options, this);
        this.connections[0] = firstConnection;
        if (reserved) {
          firstConnection.flags |= PooledConnectionFlags.preReserved; // lets pre reserve the first connection
        }
        for (let i = 1; i < pollSize; i++) {
          this.connections[i] = new PooledPostgresConnection(this.options, this);
        }
        return;
      }
      if (reserved) {
        let connectionWithLeastQueries: PooledPostgresConnection | null = null;
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

  export class PostgresAdapter implements DatabaseAdapter<PooledPostgresConnection> {
    private pool: PostgresConnectionPool;

    get closed() {
      return this.pool.closed;
    }

    constructor(options: Bun.SQL.__internal.DefinedPostgresOptions) {
      this.pool = new PostgresConnectionPool(options);
    }

    normalizeQuery(strings: string | TemplateStringsArray, values: unknown[]): [string, unknown[]] {
      return normalizeQuery(strings, values);
    }

    createQueryHandle(sqlString: string, values: unknown[], flags: number, poolSize: number): any {
      if (!(flags & SQLQueryFlags.allowUnsafeTransaction)) {
        if (poolSize !== 1) {
          const upperCaseSqlString = sqlString.toUpperCase().trim();
          if (upperCaseSqlString.startsWith("BEGIN") || upperCaseSqlString.startsWith("START TRANSACTION")) {
            throw $ERR_POSTGRES_UNSAFE_TRANSACTION("Only use sql.begin, sql.reserved or max: 1");
          }
        }
      }

      return createPostgresQuery(
        sqlString,
        values,
        new SQLResultArray(),
        undefined,
        !!(flags & SQLQueryFlags.bigint),
        !!(flags & SQLQueryFlags.simple),
      );
    }

    connect(onConnected: OnConnected<PooledPostgresConnection>, reserved: boolean = false): void {
      if (!this.pool) throw new Error("Adapter not initialized");
      this.pool.connect(onConnected, reserved);
    }

    release(connection: any, connectingEvent: boolean = false): void {
      if (!this.pool) throw new Error("Adapter not initialized");
      this.pool.release(connection, connectingEvent);
    }

    async close(options?: { timeout?: number }): Promise<void> {
      if (!this.pool) throw new Error("Adapter not initialized");
      return this.pool.close(options);
    }

    flush(): void {
      if (!this.pool) throw new Error("Adapter not initialized");
      this.pool.flush();
    }

    isConnected(): boolean {
      return this.pool.isConnected();
    }

    reserve<T>(sql: any, onReserveConnected: (resolvers: PromiseWithResolvers<T>) => void): Promise<T> {
      // PostgreSQL uses connection pooling - get a reserved connection
      const promiseWithResolvers = Promise.withResolvers();
      this.connect(onReserveConnected.bind(promiseWithResolvers), true);
      return promiseWithResolvers.promise;
    }

    getBeginCommand(options?: string, distributedName?: string): string {
      if (distributedName) {
        // Distributed transaction - prepare transaction instead of commit
        return `BEGIN`;
      }
      return options ? `BEGIN ${options}` : "BEGIN";
    }

    getCommitCommand(distributedName?: string): string {
      if (distributedName) {
        return `PREPARE TRANSACTION '${distributedName}'`;
      }
      return "COMMIT";
    }

    getRollbackCommand(distributedName?: string): string {
      return "ROLLBACK";
    }

    getBeforeCommitOrRollbackCommand(distributedName?: string): string | null {
      return null; // PostgreSQL doesn't need this
    }

    supportsDistributedTransactions(): boolean {
      return true;
    }

    async commitDistributed(name: string, sql: any): Promise<any> {
      return await sql.unsafe(`COMMIT PREPARED '${name}'`);
    }

    async rollbackDistributed(name: string, sql: any): Promise<any> {
      return await sql.unsafe(`ROLLBACK PREPARED '${name}'`);
    }
  }
}

class SQLiteConnection {
  private db: any;

  constructor(db?: any) {
    this.db = db;
  }

  getDatabase() {
    return this.db;
  }
}

class SQLiteAdapter implements DatabaseAdapter<SQLiteConnection> {
  private db: InstanceType<(typeof import("./sqlite.ts"))["default"]["Database"]> | null = null;

  get closed() {
    return this.db === null;
  }

  public constructor(options: Bun.SQL.__internal.DefinedSQLiteOptions) {
    const SQLiteModule = SQLite.getBunSqliteModule();
    this.db = new SQLiteModule.Database(options.filename);
  }

  normalizeQuery(strings: any, values: any): [string, any[]] {
    if (typeof strings === "string") {
      return [strings, values || []];
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
          if (value instanceof SQLHelper) {
            // Handle SQLHelper for bulk inserts, updates, etc.
            const command = detectCommand(query);
            const { columns, value: items } = value as SQLHelper;
            const columnCount = columns.length;

            if (command === SQLCommand.insert) {
              // INSERT INTO table (col1, col2) VALUES (?, ?), (?, ?)
              query += "(";
              for (let j = 0; j < columnCount; j++) {
                query += escapeIdentifier(columns[j]);
                if (j < columnCount - 1) {
                  query += ", ";
                }
              }
              query += ") VALUES";

              if (Array.isArray(items)) {
                const itemsCount = items.length;
                for (let j = 0; j < itemsCount; j++) {
                  query += "(";
                  const item = items[j];
                  for (let k = 0; k < columnCount; k++) {
                    const column = columns[k];
                    const columnValue = item[column];
                    query += "?";
                    if (k < columnCount - 1) {
                      query += ", ";
                    }
                    binding_values.push(columnValue === undefined ? null : columnValue);
                  }
                  query += ")";
                  if (j < itemsCount - 1) {
                    query += ",";
                  }
                }
              } else {
                // Single object insert
                query += "(";
                for (let k = 0; k < columnCount; k++) {
                  const column = columns[k];
                  const columnValue = items[column];
                  query += "?";
                  if (k < columnCount - 1) {
                    query += ", ";
                  }
                  binding_values.push(columnValue === undefined ? null : columnValue);
                }
                query += ")";
              }
            } else if (command === SQLCommand.whereIn) {
              // WHERE column IN (?, ?, ?)
              query += "(";
              const items_array = Array.isArray(items) ? items : [items];
              for (let j = 0; j < items_array.length; j++) {
                query += "?";
                if (j < items_array.length - 1) {
                  query += ", ";
                }
                binding_values.push(items_array[j]);
              }
              query += ")";
            } else if (command === SQLCommand.updateSet) {
              // UPDATE table SET col1 = ?, col2 = ?
              for (let j = 0; j < columnCount; j++) {
                query += escapeIdentifier(columns[j]) + " = ?";
                if (j < columnCount - 1) {
                  query += ", ";
                }
                const columnValue = items[columns[j]];
                binding_values.push(columnValue === undefined ? null : columnValue);
              }
            } else {
              // For other commands or unrecognized patterns, just add placeholders
              query += "?";
              binding_values.push(value);
            }
          } else {
            // Regular value
            query += "?";
            binding_values.push(value);
          }
        }
      }
    }

    return [query, binding_values];
  }

  createQueryHandle(sqlString: string, values: any[] = [], flags: number = 0): any {
    if (this.db === null) throw new Error("SQLite database not initialized");

    // For simple queries (no parameters), check if we might have multiple statements
    // by looking for semicolons that aren't in strings
    const isSimple = (flags & SQLQueryFlags.simple) !== 0;
    const hasNoParams = !values || values.length === 0;
    let useMultiStatementMode = false;

    if (isSimple && hasNoParams) {
      // Simple heuristic: check if there are multiple statements
      // This is not perfect but should handle most cases
      const trimmed = sqlString.trim();
      // Remove string literals and comments to check for real semicolons
      const withoutStrings = trimmed.replace(/'[^']*'/g, "").replace(/"[^"]*"/g, "");
      const withoutComments = withoutStrings.replace(/--[^\n]*/g, "").replace(/\/\*[^*]*\*\//g, "");

      // Count semicolons that aren't at the end
      const semicolons = withoutComments.match(/;/g);
      if (semicolons && semicolons.length > 1) {
        // Likely multiple statements
        useMultiStatementMode = true;
      } else if (semicolons && semicolons.length === 1 && !withoutComments.trim().endsWith(";")) {
        // Semicolon in the middle, likely multiple statements
        useMultiStatementMode = true;
      }
    }

    // Prepare the statement normally if not multi-statement
    let statement: InstanceType<(typeof import("./sqlite.ts"))["default"]["Statement"]> | null = null;
    if (!useMultiStatementMode) {
      statement = this.db.prepare(sqlString, values || [], 0);
    }

    return {
      statement,
      values,
      flags,
      useMultiStatementMode,
      run: (connection, query) => {
        try {
          // Get the actual database from SQLiteConnection if needed
          const db = connection?.getDatabase ? connection.getDatabase() : this.db;
          if (!db) {
            throw new Error("SQLite database not initialized");
          }

          // If it's a multi-statement query, execute all statements
          if (useMultiStatementMode) {
            // Execute all statements using run/exec
            db.run(sqlString);

            // Try to get result from the last SELECT if any
            // Look for the last complete SELECT statement
            const selectMatches = sqlString.match(/SELECT[^;]*;?\s*$/i);
            if (selectMatches) {
              const lastSelect = selectMatches[0].replace(/;\s*$/, "").trim();
              if (lastSelect) {
                // Execute the last SELECT to get results
                const lastStatement = db.prepare(lastSelect, [], 0);
                const result = lastStatement.all();
                const resultArray = new SQLResultArray();
                if (Array.isArray(result)) {
                  resultArray.push(...result);
                }
                resultArray.command = "SELECT";
                resultArray.count = result?.length || 0;
                query.resolve(resultArray);
                return;
              }
            }

            // No SELECT at the end, return empty result with changes info
            const resultArray = new SQLResultArray();
            resultArray.command = null;
            resultArray.count = 0;
            query.resolve(resultArray);
            return;
          }

          const commandMatch = sqlString.trim().match(/^(\w+)/);
          const cmd = commandMatch ? commandMatch[1].toUpperCase() : "";

          let result: unknown[];
          let changes = 0;

          // For transaction control statements (BEGIN, COMMIT, ROLLBACK, SAVEPOINT, etc.)
          if (cmd === "BEGIN" || cmd === "COMMIT" || cmd === "ROLLBACK" || cmd === "SAVEPOINT" || cmd === "RELEASE") {
            $assert(statement, "Statement is not initialized");
            statement.run(...values);
            result = [];
            changes = 0;
          }
          // For data modification statements without RETURNING, use run() to get changes count
          else if (
            (cmd === "INSERT" || cmd === "UPDATE" || cmd === "DELETE") &&
            !sqlString.toUpperCase().includes("RETURNING")
          ) {
            $assert(statement, "Statement is not initialized");
            const runResult = statement.run(...values);
            changes = runResult.changes;
            result = [];
          } else {
            // Use all() for SELECT or queries with RETURNING clause
            $assert(statement, "Statement is not initialized");
            result = statement.all(...values);

            // For INSERT/UPDATE/DELETE with RETURNING, count the returned rows
            if (cmd === "INSERT" || cmd === "UPDATE" || cmd === "DELETE") {
              changes = Array.isArray(result) ? result.length : 0;
            }
          }

          const resultArray = new SQLResultArray();
          if (Array.isArray(result)) {
            resultArray.push(...result);
          }

          resultArray.command = cmd;

          if (cmd === "INSERT" || cmd === "UPDATE" || cmd === "DELETE") {
            resultArray.count = changes;
          } else {
            resultArray.count = result?.length || 0;
          }

          query.resolve(resultArray);
        } catch (err) {
          query.reject(err);
        }
      },
      done: () => {
        // No-op for SQLite - PostgreSQL uses this for cleanup
      },
    };
  }

  connect(onConnected: OnConnected<SQLiteConnection>, _reserved: boolean = false): void {
    // SQLite doesn't need connection pooling - return the single connection
    if (this.db) {
      const connection = new SQLiteConnection(this.db);
      onConnected(null, connection);
    } else {
      onConnected(new Error("SQLite database not initialized"), null);
    }
  }

  release(_connection: SQLiteConnection, _connectingEvent: boolean = false): void {
    // SQLite has nothing it needs to clean up
  }

  async close(_options?: { timeout?: number }): Promise<void> {
    // SQLite close is synchronous, so timeout is not applicable
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  flush(): void {
    throw new Error("SQLite doesn't support flush() - queries are executed synchronously");
  }

  isConnected(): boolean {
    return !!this.db;
  }

  reserve<T>(_sql: Bun.SQL, _onReserveConnected: (resolvers: PromiseWithResolvers<T>) => void): Promise<T> {
    // SQLite doesn't use connection pooling, so reserve doesn't make sense
    return Promise.reject(new Error("SQLite doesn't support connection reservation (no connection pool)"));
  }

  getBeginCommand(options?: string, distributedName?: string): string {
    if (distributedName) {
      throw new Error("SQLite doesn't support distributed transactions");
    }
    // SQLite transaction modes: DEFERRED, IMMEDIATE, EXCLUSIVE
    if (options) {
      const upperOptions = options.toUpperCase();
      if (upperOptions.includes("READ")) {
        return "BEGIN DEFERRED";
      } else if (upperOptions.includes("IMMEDIATE")) {
        return "BEGIN IMMEDIATE";
      } else if (upperOptions.includes("EXCLUSIVE")) {
        return "BEGIN EXCLUSIVE";
      }
    }
    return "BEGIN DEFERRED";
  }

  getCommitCommand(distributedName?: string): string {
    if (distributedName) {
      throw new Error("SQLite doesn't support distributed transactions");
    }
    return "COMMIT";
  }

  getRollbackCommand(distributedName?: string): string {
    if (distributedName) {
      throw new Error("SQLite doesn't support distributed transactions");
    }
    return "ROLLBACK";
  }

  getBeforeCommitOrRollbackCommand(_distributedName?: string): string | null {
    // SQLite doesn't require any command before COMMIT or ROLLBACK
    // (PostgreSQL needs this for distributed transactions)
    return null;
  }

  supportsDistributedTransactions(): boolean {
    return false;
  }

  async commitDistributed(_name: string, _sql: any): Promise<any> {
    throw new Error("SQLite doesn't support distributed transactions");
  }

  async rollbackDistributed(_name: string, _sql: any): Promise<any> {
    throw new Error("SQLite doesn't support distributed transactions");
  }
}

class Query<T = any> extends PublicPromise<T> {
  [_resolve]: (value: T) => void;
  [_reject]: (reason?: any) => void;
  [_handle];
  [_handler];
  [_queryStatus] = 0;
  [_strings];
  [_values];
  [_poolSize]: number;
  [_flags]: number;
  [_results]: any;

  private adapter: DatabaseAdapter<any>;

  [Symbol.for("nodejs.util.inspect.custom")]() {
    const status = this[_queryStatus];

    let query = "";
    if ((status & QueryStatus.active) != 0) query += "active ";
    if ((status & QueryStatus.cancelled) != 0) query += "cancelled ";
    if ((status & QueryStatus.executed) != 0) query += "executed ";
    if ((status & QueryStatus.error) != 0) query += "error ";

    return `Query { ${query} }`;
  }

  constructor(
    strings: string | TemplateStringsArray | SQLHelper | Query<any>,
    values: any[],
    flags: number,
    poolSize: number,
    handler: (query: Query<T>, handle) => any,
    adapter: DatabaseAdapter<any>,
  ) {
    let resolve_: (value: T) => void, reject_: (reason?: any) => void;
    super((resolve, reject) => {
      resolve_ = resolve;
      reject_ = reject;
    });

    if (typeof strings === "string") {
      if (!(flags & SQLQueryFlags.unsafe)) {
        // identifier (cannot be executed in safe mode)
        flags |= SQLQueryFlags.notTagged;
        strings = escapeIdentifier(strings);
      }
    }

    this[_resolve] = resolve_!;
    this[_reject] = reject_!;
    this[_handle] = null;
    this[_handler] = handler;
    this[_queryStatus] = 0;
    this[_poolSize] = poolSize;
    this[_strings] = strings;
    this[_values] = values;
    this[_flags] = flags;

    this[_results] = null;
    this.adapter = adapter;
  }

  private getQueryHandle() {
    let handle = this[_handle];
    if (!handle) {
      try {
        const [sqlString, final_values] = this.adapter.normalizeQuery(this[_strings], this[_values]);
        this[_handle] = handle = this.adapter.createQueryHandle(sqlString, final_values, this[_flags], this[_poolSize]);
      } catch (err) {
        this[_queryStatus] |= QueryStatus.error | QueryStatus.invalidHandle;
        this.reject(err);
      }
    }
    return handle;
  }

  async [_run](async: boolean) {
    const { [_handler]: handler, [_queryStatus]: status } = this;

    if (status & (QueryStatus.executed | QueryStatus.error | QueryStatus.cancelled | QueryStatus.invalidHandle)) {
      return;
    }
    if (this[_flags] & SQLQueryFlags.notTagged) {
      this.reject(notTaggedCallError());
      return;
    }
    this[_queryStatus] |= QueryStatus.executed;

    const handle = this.getQueryHandle();
    if (!handle) return this;

    if (async) {
      // Ensure it's actually async
      // eslint-disable-next-line
      await 1;
    }

    try {
      return handler(this, handle);
    } catch (err) {
      this[_queryStatus] |= QueryStatus.error;
      this.reject(err);
    }
  }
  get active() {
    return (this[_queryStatus] & QueryStatus.active) != 0;
  }

  set active(value) {
    const status = this[_queryStatus];
    if (status & (QueryStatus.cancelled | QueryStatus.error)) {
      return;
    }

    if (value) {
      this[_queryStatus] |= QueryStatus.active;
    } else {
      this[_queryStatus] &= ~QueryStatus.active;
    }
  }

  get cancelled() {
    return (this[_queryStatus] & QueryStatus.cancelled) !== 0;
  }

  resolve(x: T) {
    this[_queryStatus] &= ~QueryStatus.active;
    const handle = this.getQueryHandle();
    if (!handle) return this;
    handle.done();
    return this[_resolve](x);
  }

  reject(x: any) {
    this[_queryStatus] &= ~QueryStatus.active;
    this[_queryStatus] |= QueryStatus.error;
    if (!(this[_queryStatus] & QueryStatus.invalidHandle)) {
      const handle = this.getQueryHandle();
      if (!handle) return this[_reject](x);
      handle.done();
    }

    return this[_reject](x);
  }

  cancel() {
    var status = this[_queryStatus];
    if (status & QueryStatus.cancelled) {
      return this;
    }
    this[_queryStatus] |= QueryStatus.cancelled;

    if (status & QueryStatus.executed) {
      const handle = this.getQueryHandle();
      handle.cancel();
    }

    return this;
  }

  execute() {
    this[_run](false);
    return this;
  }

  raw() {
    const handle = this.getQueryHandle();
    if (!handle) return this;
    handle.setMode(SQLQueryResultMode.raw);
    return this;
  }

  simple() {
    this[_flags] |= SQLQueryFlags.simple;
    return this;
  }

  values() {
    const handle = this.getQueryHandle();
    if (!handle) return this;
    handle.setMode(SQLQueryResultMode.values);
    return this;
  }

  then() {
    if (this[_flags] & SQLQueryFlags.notTagged) {
      throw notTaggedCallError();
    }
    this[_run](true);
    const result = super.$then.$apply(this, arguments);
    $markPromiseAsHandled(result);
    return result;
  }

  catch() {
    if (this[_flags] & SQLQueryFlags.notTagged) {
      throw notTaggedCallError();
    }
    this[_run](true);
    const result = super.catch.$apply(this, arguments);
    $markPromiseAsHandled(result);
    return result;
  }

  finally(_callback: (value: T) => void) {
    if (this[_flags] & SQLQueryFlags.notTagged) {
      throw notTaggedCallError();
    }
    this[_run](true);
    return super.finally.$apply(this, arguments);
  }
}

Object.defineProperty(Query, Symbol.species, { value: PublicPromise });
Object.defineProperty(Query, Symbol.toStringTag, { value: "Query" });
initPostgres(
  function onResolvePostgresQuery(query, result, commandTag, count, queries, is_last) {
    /// simple queries
    if (query[_flags] & SQLQueryFlags.simple) {
      // simple can have multiple results or a single result
      if (is_last) {
        if (queries) {
          const queriesIndex = queries.indexOf(query);
          if (queriesIndex !== -1) {
            queries.splice(queriesIndex, 1);
          }
        }
        try {
          query.resolve(query[_results]);
        } catch {}
        return;
      }
      $assert(result instanceof SQLResultArray, "Invalid result array");
      // prepare for next query
      query[_handle].setPendingValue(new SQLResultArray());

      if (typeof commandTag === "string") {
        if (commandTag.length > 0) {
          result.command = commandTag;
        }
      } else {
        result.command = cmds[commandTag];
      }

      result.count = count || 0;
      const last_result = query[_results];

      if (!last_result) {
        query[_results] = result;
      } else {
        if (last_result instanceof SQLResultArray) {
          // multiple results
          query[_results] = [last_result, result];
        } else {
          // 3 or more results
          last_result.push(result);
        }
      }
      return;
    }
    /// prepared statements
    $assert(result instanceof SQLResultArray, "Invalid result array");
    if (typeof commandTag === "string") {
      if (commandTag.length > 0) {
        result.command = commandTag;
      }
    } else {
      result.command = cmds[commandTag];
    }

    result.count = count || 0;
    if (queries) {
      const queriesIndex = queries.indexOf(query);
      if (queriesIndex !== -1) {
        queries.splice(queriesIndex, 1);
      }
    }
    try {
      query.resolve(result);
    } catch {}
  },
  function onRejectPostgresQuery(query, reject, queries) {
    if (queries) {
      const queriesIndex = queries.indexOf(query);
      if (queriesIndex !== -1) {
        queries.splice(queriesIndex, 1);
      }
    }

    try {
      query.reject(reject);
    } catch {}
  },
);

function onQueryFinish(onClose: (err: Error) => void) {
  this.queries.delete(onClose);
  this.pool.release(this);
}

enum PooledConnectionState {
  pending = 0,
  connected = 1,
  closed = 2,
}
enum PooledConnectionFlags {
  /// canBeConnected is used to indicate that at least one time we were able to connect to the database
  canBeConnected = 1 << 0,
  /// reserved is used to indicate that the connection is currently reserved
  reserved = 1 << 1,
  /// preReserved is used to indicate that the connection will be reserved in the future when queryCount drops to 0
  preReserved = 1 << 2,
}

class PooledPostgresConnection {
  pool: Postgres.PostgresConnectionPool;
  connection: $ZigGeneratedClasses.PostgresSQLConnection | null = null;
  state: PooledConnectionState = PooledConnectionState.pending;
  storedError: Error | null = null;
  queries: Set<(err: Error) => void> = new Set();
  onFinish: ((err: Error | null) => void) | null = null;
  connectionInfo: any;
  flags: number = 0;
  /// queryCount is used to indicate the number of queries using the connection, if a connection is reserved or if its a transaction queryCount will be 1 independently of the number of queries
  queryCount: number = 0;
  #onConnected(err, _) {
    const connectionInfo = this.connectionInfo;
    if (connectionInfo?.onconnect) {
      connectionInfo.onconnect(err);
    }
    this.storedError = err;
    if (!err) {
      this.flags |= PooledConnectionFlags.canBeConnected;
    }
    this.state = err ? PooledConnectionState.closed : PooledConnectionState.connected;
    const onFinish = this.onFinish;
    if (onFinish) {
      this.queryCount = 0;
      this.flags &= ~PooledConnectionFlags.reserved;
      this.flags &= ~PooledConnectionFlags.preReserved;

      // pool is closed, lets finish the connection
      // pool is closed, lets finish the connection
      if (err) {
        onFinish(err);
      } else {
        this.connection?.close();
      }
      return;
    }
    this.pool.release(this, true);
  }
  #onClose(err) {
    const connectionInfo = this.connectionInfo;
    if (connectionInfo?.onclose) {
      connectionInfo.onclose(err);
    }
    this.state = PooledConnectionState.closed;
    this.connection = null;
    this.storedError = err;

    // remove from ready connections if its there
    this.pool.readyConnections.delete(this);
    const queries = new Set(this.queries);
    this.queries.clear();
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

    this.pool.release(this, true);
  }
  constructor(connectionInfo, pool: Postgres.PostgresConnectionPool) {
    this.state = PooledConnectionState.pending;
    this.pool = pool;
    this.connectionInfo = connectionInfo;
    this.#startConnection();
  }
  async #startConnection() {
    this.connection = (await createConnection(
      this.connectionInfo,
      this.#onConnected.bind(this),
      this.#onClose.bind(this),
    )) as $ZigGeneratedClasses.PostgresSQLConnection;
  }

  onClose(onClose: (err: Error) => void) {
    this.queries.add(onClose);
  }

  bindQuery<T>(query: Query<T>, onClose: (err: Error) => void) {
    this.queries.add(onClose);
    query.finally(onQueryFinish.bind(this, onClose));
  }

  #doRetry() {
    if (this.pool.closed) {
      return;
    }
    // reset error and state
    this.storedError = null;
    this.state = PooledConnectionState.pending;
    // retry connection
    this.#startConnection();
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
    if (this.pool.closed) {
      return false;
    }
    // we need to reconnect
    // lets use a retry strategy

    // we can only retry if one day we are able to connect
    if (this.flags & PooledConnectionFlags.canBeConnected) {
      this.#doRetry();
    } else {
      // analyse type of error to see if we can retry
      switch (this.storedError?.code) {
        case "ERR_POSTGRES_UNSUPPORTED_AUTHENTICATION_METHOD":
        case "ERR_POSTGRES_UNKNOWN_AUTHENTICATION_METHOD":
        case "ERR_POSTGRES_TLS_NOT_AVAILABLE":
        case "ERR_POSTGRES_TLS_UPGRADE_FAILED":
        case "ERR_POSTGRES_INVALID_SERVER_SIGNATURE":
        case "ERR_POSTGRES_INVALID_SERVER_KEY":
        case "ERR_POSTGRES_AUTHENTICATION_FAILED_PBKDF2":
          // we can't retry these are authentication errors
          return false;
        default:
          // we can retry
          this.#doRetry();
      }
    }
    return true;
  }
}

async function createConnection(options: Bun.SQL.__internal.DefinedPostgresOptions, onConnected, onClose) {
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

    // @ts-expect-error Path is not specified in the types right now
    path,
  } = options;

  let password: string | Bun.MaybePromise<string> | (() => Bun.MaybePromise<string>) | undefined = options.password;

  try {
    if (typeof password === "function") {
      password = password();
      if (password && $isPromise(password)) {
        password = await password;
      }
    }

    return createPostgresConnection(
      hostname,
      Number(port),
      username || "",
      password || "",
      database || "",
      // > The default value for sslmode is prefer. As is shown in the table, this
      // makes no sense from a security point of view, and it only promises
      // performance overhead if possible. It is only provided as the default for
      // backward compatibility, and is not recommended in secure deployments.
      sslMode || Postgres.SSLMode.disable,
      tls || null,
      query || "",
      path || "",
      onConnected,
      onClose,
      idleTimeout,
      connectionTimeout,
      maxLifetime,
      !prepare,
    ) as $ZigGeneratedClasses.PostgresSQLConnection;
  } catch (e) {
    onClose(e);
  }
}

class SQLHelper {
  value: any;
  columns: string[];
  constructor(value, keys) {
    if (keys?.length === 0) {
      keys = Object.keys(value[0]);
    }

    for (let key of keys) {
      if (typeof key === "string") {
        const asNumber = Number(key);
        if (Number.isNaN(asNumber)) {
          continue;
        }
        key = asNumber;
      }

      if (typeof key !== "string") {
        if (Number.isSafeInteger(key)) {
          if (key >= 0 && key <= 64 * 1024) {
            continue;
          }
        }

        throw new Error(`Keys must be strings or numbers: ${key}`);
      }
    }

    this.value = value;
    this.columns = keys;
  }
}

function decodeIfValid(value: string | null | undefined) {
  if (value) {
    return decodeURIComponent(value);
  }

  return null;
}

/** Finds what is definitely a valid sqlite string, where there is no ambiguity with sqlite and another database adapter */
function parseDefinitelySqliteUrl(value: string | URL): string | null {
  const str = value instanceof URL ? value.toString() : value;

  // ':memory:' is a sqlite url
  if (str === ":memory:" || str === "sqlite://:memory:" || str === "sqlite:memory") return ":memory:";

  if (str.startsWith("sqlite://")) return new URL(str).pathname;
  if (str.startsWith("sqlite:")) return str.slice(7); // "sqlite:".length

  // We can't guarantee this is exclusively an sqlite url here
  // even if it *could* be
  return null;
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
  if (options.adapter === undefined) {
    return; // best effort
  }

  if (!isOptionsOfAdapter(options, adapter)) {
    throw new Error(`Expected options to be of adapter ${adapter}, but got ${options.adapter}`);
  }
}

function parseOptions(
  stringOrUrlOrOptions: Bun.SQL.Options | string | URL | undefined,
  definitelyOptionsButMaybeEmpty: Bun.SQL.Options,
): Bun.SQL.__internal.DefinedOptions {
  let [stringOrUrl, options]: [string | URL | null, Bun.SQL.Options] =
    typeof stringOrUrlOrOptions === "string" || stringOrUrlOrOptions instanceof URL
      ? [stringOrUrlOrOptions, definitelyOptionsButMaybeEmpty]
      : stringOrUrlOrOptions
        ? [null, { ...stringOrUrlOrOptions, ...definitelyOptionsButMaybeEmpty }]
        : [null, definitelyOptionsButMaybeEmpty];

  if (options.adapter === undefined && stringOrUrl !== null) {
    const sqliteUrl = parseDefinitelySqliteUrl(stringOrUrl);

    if (sqliteUrl !== null) {
      return {
        ...options,
        adapter: "sqlite",
        filename: sqliteUrl,
      };
    }
  }

  if (options.adapter === "sqlite") {
    return {
      ...options,
      adapter: "sqlite",
      filename: options.filename || stringOrUrl || ":memory:",
    };
  }

  if (options.adapter !== undefined && options.adapter !== "postgres" && options.adapter !== "postgresql") {
    options.adapter satisfies never; // This will type error if we support a new adapter in the future, which will let us know to update this check
    throw new UnsupportedAdapterError(options);
  }

  assertIsOptionsOfAdapter(options, "postgres");

  // TODO: Better typing for these vars
  let hostname: any,
    port: number | string | undefined,
    username: string | null | undefined,
    password: string | (() => Bun.MaybePromise<string>) | undefined | null,
    database: any,
    tls,
    url: URL | undefined,
    query: string,
    idleTimeout: number | null | undefined,
    connectionTimeout: number | null | undefined,
    maxLifetime: number | null | undefined,
    onconnect: ((client: Bun.SQL) => void) | undefined,
    onclose: ((client: Bun.SQL) => void) | undefined,
    max: number | null | undefined,
    bigint: any,
    path: string | string[];

  let prepare = true;
  const env = Bun.env || {};
  var sslMode: Postgres.SSLMode = Postgres.SSLMode.disable;

  if (stringOrUrl === undefined || (typeof stringOrUrl === "string" && stringOrUrl.length === 0)) {
    let urlString = env.POSTGRES_URL || env.DATABASE_URL || env.PGURL || env.PG_URL;

    if (!urlString) {
      urlString = env.TLS_POSTGRES_DATABASE_URL || env.TLS_DATABASE_URL;

      if (urlString) {
        sslMode = Postgres.SSLMode.require;
      }
    }

    if (urlString) {
      url = new URL(urlString);
    }
  } else if (stringOrUrl && typeof stringOrUrl === "object") {
    if (stringOrUrl instanceof URL) {
      url = stringOrUrl;
    } else if (options?.url) {
      const _url = options.url;
      if (typeof _url === "string") {
        url = new URL(_url);
      } else if (_url && typeof _url === "object" && _url instanceof URL) {
        url = _url;
      }
    }
    if (options?.tls) {
      sslMode = Postgres.SSLMode.require;
      tls = options.tls;
    }
  } else if (typeof stringOrUrl === "string") {
    url = new URL(stringOrUrl);
  }
  query = "";

  if (url) {
    ({ hostname, port, username, password } = options);
    // object overrides url
    hostname ||= url.hostname;
    port ||= url.port;
    username ||= decodeIfValid(url.username);
    password ||= decodeIfValid(url.password);

    const queryObject = url.searchParams.toJSON();
    for (const key in queryObject) {
      if (key.toLowerCase() === "sslmode") {
        sslMode = Postgres.normalizeSSLMode(queryObject[key]);
      } else if (key.toLowerCase() === "path") {
        path = queryObject[key];
      } else {
        // this is valid for postgres for other databases it might not be valid
        // check adapter then implement for other databases
        // encode string with \0 as finalizer
        // must be key\0value\0
        query += `${key}\0${queryObject[key]}\0`;
      }
    }
    query = query.trim();
  }
  hostname ||= options.hostname || options.host || env.PGHOST || "localhost";

  port ||= Number(options.port || env.PGPORT || 5432);

  path ||= (options as { path?: string }).path || "";
  // add /.s.PGSQL.${port} if it doesn't exist
  if (path && path?.indexOf("/.s.PGSQL.") === -1) {
    path = `${path}/.s.PGSQL.${port}`;
  }

  username ||=
    options.username || options.user || env.PGUSERNAME || env.PGUSER || env.USER || env.USERNAME || "postgres";
  database ||=
    options.database || options.db || decodeIfValid((url?.pathname ?? "").slice(1)) || env.PGDATABASE || username;
  password ||= options.password || options.pass || env.PGPASSWORD || "";
  const connection = options.connection;
  if (connection && $isObject(connection)) {
    for (const key in connection) {
      if (connection[key] !== undefined) {
        query += `${key}\0${connection[key]}\0`;
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

  if (sslMode !== Postgres.SSLMode.disable && !tls?.serverName) {
    if (hostname) {
      tls = { ...tls, serverName: hostname };
    } else if (tls) {
      tls = true;
    }
  }

  if (tls && sslMode === Postgres.SSLMode.disable) {
    sslMode = Postgres.SSLMode.prefer;
  }
  port = Number(port);

  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw $ERR_INVALID_ARG_VALUE("port", port, "must be a non-negative integer between 1 and 65535");
  }

  const ret: Bun.SQL.__internal.DefinedPostgresOptions = {
    adapter: "postgres",
    hostname,
    port,
    username,
    password,
    database,
    tls,
    prepare,
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

  return ret;
}

enum ReservedConnectionState {
  acceptQueries = 1 << 0,
  closed = 1 << 1,
}

function assertValidTransactionName(name: string) {
  if (name.indexOf("'") !== -1) {
    throw Error(`Distributed transaction name cannot contain single quotes.`);
  }
}

class UnsupportedAdapterError extends Error {
  public options: Bun.SQL.Options;

  constructor(options: Bun.SQL.Options) {
    super(`Unsupported adapter: ${options.adapter}. Supported adapters: "postgres", "sqlite"`);
    this.options = options;
  }
}

function createAdapter(options: Bun.SQL.__internal.DefinedOptions): DatabaseAdapter<any> {
  switch (options.adapter) {
    case "postgres":
      return new Postgres.PostgresAdapter(options as Bun.SQL.__internal.DefinedPostgresOptions);
    case "sqlite":
      return new SQLiteAdapter(options as Bun.SQL.__internal.DefinedSQLiteOptions);

    default: {
      options satisfies never;
      throw new UnsupportedAdapterError(options);
    }
  }
}

const SQL: typeof Bun.SQL = function SQL(
  stringOrUrlOrOptions: Bun.SQL.Options | string | undefined = undefined,
  definitelyOptionsButMaybeEmpty: Bun.SQL.Options = {},
): Bun.SQL {
  const resolvedOptions = parseOptions(stringOrUrlOrOptions, definitelyOptionsButMaybeEmpty);

  const adapter = createAdapter(resolvedOptions);

  function onQueryDisconnected<T>(this: Query<T>, err: Error | null) {
    // connection closed mid query this will not be called if the query finishes first
    const query = this;
    if (err) {
      return query.reject(err);
    }

    // query is cancelled when waiting for a connection from the pool
    if (query.cancelled) {
      return query.reject($ERR_POSTGRES_QUERY_CANCELLED("Query cancelled"));
    }
  }

  function onQueryConnected<T>(
    this: Query<T>,
    handle: ReturnType<typeof adapter.createQueryHandle>,
    err: Error | null,
    connection: any,
  ) {
    const query = this;
    if (err) {
      // fail to aquire a connection from the pool
      return query.reject(err);
    }
    // query is cancelled when waiting for a connection from the pool
    if (query.cancelled) {
      adapter.release(connection); // release the connection back to the pool
      return query.reject($ERR_POSTGRES_QUERY_CANCELLED("Query cancelled"));
    }

    // For PostgreSQL, we need to bind the query to track disconnection
    // For SQLite, we just run the query directly
    if (resolvedOptions.adapter === "postgres") {
      const pooledConnection = connection as PooledPostgresConnection;
      pooledConnection.bindQuery(query, onQueryDisconnected.bind(query));
      handle.run(pooledConnection.connection, query);
    } else {
      // SQLite - run the query directly
      handle.run(connection, query);
    }
  }

  function queryFromPoolHandler(query, handle, err) {
    if (err) {
      // fail to create query
      return query.reject(err);
    }
    // query is cancelled
    if (!handle || query.cancelled) {
      return query.reject($ERR_POSTGRES_QUERY_CANCELLED("Query cancelled"));
    }

    adapter.connect(onQueryConnected.bind(query, handle));
  }

  function queryFromPool(strings: string | TemplateStringsArray | SQLHelper | Query<any>, values: unknown[]) {
    try {
      return new Query(
        strings,
        values,
        resolvedOptions.bigint ? SQLQueryFlags.bigint : SQLQueryFlags.none,
        resolvedOptions.max,
        queryFromPoolHandler,
        adapter,
      );
    } catch (err) {
      return Promise.reject(err);
    }
  }

  function unsafeQuery(strings: string | TemplateStringsArray, values: unknown[]) {
    try {
      let flags = resolvedOptions.bigint ? SQLQueryFlags.bigint | SQLQueryFlags.unsafe : SQLQueryFlags.unsafe;
      if ((values?.length ?? 0) === 0) {
        flags |= SQLQueryFlags.simple;
      }
      return new Query(strings, values, flags, resolvedOptions.max, queryFromPoolHandler, adapter);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  function onTransactionQueryDisconnected(query) {
    const transactionQueries = this;
    transactionQueries.delete(query);
  }
  function queryFromTransactionHandler(transactionQueries, query, handle, err) {
    const pooledConnection = this;
    if (err) {
      transactionQueries.delete(query);
      return query.reject(err);
    }
    // query is cancelled
    if (query.cancelled) {
      transactionQueries.delete(query);
      return query.reject($ERR_POSTGRES_QUERY_CANCELLED("Query cancelled"));
    }

    query.finally(onTransactionQueryDisconnected.bind(transactionQueries, query));
    // For SQLite, pooledConnection is the connection itself
    // For PostgreSQL, pooledConnection.connection is the actual connection
    const actualConnection = pooledConnection.connection || pooledConnection;
    handle.run(actualConnection, query);
  }
  function queryFromTransaction(strings, values, pooledConnection, transactionQueries, state?) {
    try {
      // Check if this is a write operation in a read-only transaction
      if (state?.readOnly) {
        let sqlString = "";
        if (typeof strings === "string") {
          sqlString = strings;
        } else if (strings && strings.raw) {
          // Template literal - reconstruct the query
          sqlString = strings[0] || "";
        }

        if (sqlString) {
          const upperString = sqlString.trim().toUpperCase();
          const firstWord = upperString.split(/\s+/)[0];
          if (
            firstWord === "INSERT" ||
            firstWord === "UPDATE" ||
            firstWord === "DELETE" ||
            firstWord === "CREATE" ||
            firstWord === "DROP" ||
            firstWord === "ALTER" ||
            firstWord === "REPLACE" ||
            firstWord === "TRUNCATE"
          ) {
            return Promise.reject(new Error("attempt to write a readonly database"));
          }
        }
      }

      const query = new Query(
        strings,
        values,
        resolvedOptions.bigint
          ? SQLQueryFlags.allowUnsafeTransaction | SQLQueryFlags.bigint
          : SQLQueryFlags.allowUnsafeTransaction,
        resolvedOptions.max,
        queryFromTransactionHandler.bind(pooledConnection, transactionQueries),
        adapter,
      );
      transactionQueries.add(query);
      return query;
    } catch (err) {
      return Promise.reject(err);
    }
  }
  function unsafeQueryFromTransaction(strings, values, pooledConnection, transactionQueries) {
    try {
      let flags = resolvedOptions.bigint
        ? SQLQueryFlags.allowUnsafeTransaction | SQLQueryFlags.unsafe | SQLQueryFlags.bigint
        : SQLQueryFlags.allowUnsafeTransaction | SQLQueryFlags.unsafe;

      if ((values?.length ?? 0) === 0) {
        flags |= SQLQueryFlags.simple;
      }
      const query = new Query(
        strings,
        values,
        flags,
        resolvedOptions.max,
        queryFromTransactionHandler.bind(pooledConnection, transactionQueries),
        adapter,
      );
      transactionQueries.add(query);
      return query;
    } catch (err) {
      return Promise.reject(err);
    }
  }

  function onTransactionDisconnected(err) {
    const reject = this.reject;
    this.connectionState |= ReservedConnectionState.closed;

    for (const query of this.queries) {
      (query as Query).reject(err);
    }
    if (err) {
      return reject(err);
    }
  }

  function onReserveConnected(err, pooledConnection) {
    const { resolve, reject } = this;
    if (err) {
      return reject(err);
    }

    let reservedTransaction = new Set();

    const state = {
      connectionState: ReservedConnectionState.acceptQueries,
      reject,
      storedError: null,
      queries: new Set(),
    };
    const onClose = onTransactionDisconnected.bind(state);
    pooledConnection.onClose(onClose);

    function reserved_sql(strings: string | TemplateStringsArray | object, ...values: unknown[]) {
      if (
        state.connectionState & ReservedConnectionState.closed ||
        !(state.connectionState & ReservedConnectionState.acceptQueries)
      ) {
        return Promise.reject(connectionClosedError());
      }

      if ($isArray(strings)) {
        if (!$isArray(strings.raw)) {
          return new SQLHelper(strings, values);
        }
      } else if (typeof strings === "object" && !(strings instanceof Query) && !(strings instanceof SQLHelper)) {
        return new SQLHelper([strings], values);
      }

      // we use the same code path as the transaction sql
      return queryFromTransaction(strings, values, pooledConnection, state.queries, state);
    }

    reserved_sql.unsafe = (string: string, args: unknown[] = []) => {
      return unsafeQueryFromTransaction(string, args, pooledConnection, state.queries);
    };

    reserved_sql.file = async (path: string, args: unknown[] = []) => {
      return await Bun.file(path)
        .text()
        .then(text => unsafeQueryFromTransaction(text, args, pooledConnection, state.queries));
    };

    reserved_sql.connect = () => {
      if (state.connectionState & ReservedConnectionState.closed) {
        return Promise.reject(connectionClosedError());
      }
      return Promise.resolve(reserved_sql);
    };

    reserved_sql.commitDistributed = async function (name: string) {
      assertValidTransactionName(name);
      if (!adapter.supportsDistributedTransactions()) {
        throw Error(`${getAdapterDisplayName(resolvedOptions)} doesn't support distributed transactions`);
      }
      return await adapter.commitDistributed(name, reserved_sql);
    };
    reserved_sql.rollbackDistributed = async function (name: string) {
      assertValidTransactionName(name);
      if (!adapter.supportsDistributedTransactions()) {
        throw Error(`${getAdapterDisplayName(resolvedOptions)} doesn't support distributed transactions`);
      }
      return await adapter.rollbackDistributed(name, reserved_sql);
    };

    // reserve is allowed to be called inside reserved connection but will return a new reserved connection from the pool
    // this matchs the behavior of the postgres package
    reserved_sql.reserve = () => sql.reserve();
    function onTransactionFinished(transaction_promise: Promise<any>) {
      reservedTransaction.delete(transaction_promise);
    }
    reserved_sql.beginDistributed = (name: string, fn: TransactionCallback) => {
      // begin is allowed the difference is that we need to make sure to use the same connection and never release it
      if (state.connectionState & ReservedConnectionState.closed) {
        return Promise.reject(connectionClosedError());
      }
      let callback = fn;

      if (typeof name !== "string") {
        return Promise.reject($ERR_INVALID_ARG_VALUE("name", name, "must be a string"));
      }

      if (!$isCallable(callback)) {
        return Promise.reject($ERR_INVALID_ARG_VALUE("fn", callback, "must be a function"));
      }
      const { promise, resolve, reject } = Promise.withResolvers();
      // lets just reuse the same code path as the transaction begin
      onTransactionConnected(callback, name, resolve, reject, true, true, null, pooledConnection);
      reservedTransaction.add(promise);
      promise.finally(onTransactionFinished.bind(null, promise));
      return promise;
    };
    reserved_sql.begin = (options_or_fn: string | TransactionCallback, fn?: TransactionCallback) => {
      // begin is allowed the difference is that we need to make sure to use the same connection and never release it
      if (
        state.connectionState & ReservedConnectionState.closed ||
        !(state.connectionState & ReservedConnectionState.acceptQueries)
      ) {
        return Promise.reject(connectionClosedError());
      }
      let callback = fn;
      let options: string | undefined = options_or_fn as unknown as string;
      if ($isCallable(options_or_fn)) {
        callback = options_or_fn as unknown as TransactionCallback;
        options = undefined;
      } else if (typeof options_or_fn !== "string") {
        return Promise.reject($ERR_INVALID_ARG_VALUE("options", options_or_fn, "must be a string"));
      }
      if (!$isCallable(callback)) {
        return Promise.reject($ERR_INVALID_ARG_VALUE("fn", callback, "must be a function"));
      }
      const { promise, resolve, reject } = Promise.withResolvers();
      // lets just reuse the same code path as the transaction begin
      onTransactionConnected(callback, options, resolve, reject, true, false, null, pooledConnection);
      reservedTransaction.add(promise);
      promise.finally(onTransactionFinished.bind(null, promise));
      return promise;
    };

    reserved_sql.flush = () => {
      if (state.connectionState & ReservedConnectionState.closed) {
        throw connectionClosedError();
      }
      return pooledConnection.flush();
    };
    reserved_sql.close = async (options?: { timeout?: number }) => {
      const reserveQueries = state.queries;
      if (
        state.connectionState & ReservedConnectionState.closed ||
        !(state.connectionState & ReservedConnectionState.acceptQueries)
      ) {
        return Promise.resolve(undefined);
      }
      state.connectionState &= ~ReservedConnectionState.acceptQueries;
      let timeout = options?.timeout;
      if (timeout) {
        timeout = Number(timeout);
        if (timeout > 2 ** 31 || timeout < 0 || timeout !== timeout) {
          throw $ERR_INVALID_ARG_VALUE("options.timeout", timeout, "must be a non-negative integer less than 2^31");
        }
        if (timeout > 0 && (reserveQueries.size > 0 || reservedTransaction.size > 0)) {
          const { promise, resolve } = Promise.withResolvers();
          // race all queries vs timeout
          const pending_queries = Array.from(reserveQueries);
          const pending_transactions = Array.from(reservedTransaction);
          const timer = setTimeout(() => {
            state.connectionState |= ReservedConnectionState.closed;
            for (const query of reserveQueries) {
              (query as Query).cancel();
            }
            state.connectionState |= ReservedConnectionState.closed;
            pooledConnection.close();

            resolve();
          }, timeout * 1000);
          timer.unref(); // dont block the event loop
          Promise.all([Promise.all(pending_queries), Promise.all(pending_transactions)]).finally(() => {
            clearTimeout(timer);
            resolve();
          });
          return promise;
        }
      }
      state.connectionState |= ReservedConnectionState.closed;
      for (const query of reserveQueries) {
        (query as Query).cancel();
      }

      pooledConnection.close();

      return Promise.resolve(undefined);
    };
    reserved_sql.release = () => {
      if (
        state.connectionState & ReservedConnectionState.closed ||
        !(state.connectionState & ReservedConnectionState.acceptQueries)
      ) {
        return Promise.reject(connectionClosedError());
      }
      // just release the connection back to the pool
      state.connectionState |= ReservedConnectionState.closed;
      state.connectionState &= ~ReservedConnectionState.acceptQueries;
      pooledConnection.queries.delete(onClose);
      adapter.release(pooledConnection);
      return Promise.resolve(undefined);
    };
    // this dont need to be async dispose only disposable but we keep compatibility with other types of sql functions
    reserved_sql[Symbol.asyncDispose] = () => reserved_sql.release();
    reserved_sql[Symbol.dispose] = () => reserved_sql.release();

    reserved_sql.options = sql.options;
    reserved_sql.transaction = reserved_sql.begin;
    reserved_sql.distributed = reserved_sql.beginDistributed;
    reserved_sql.end = reserved_sql.close;
    resolve(reserved_sql);
  }
  async function onTransactionConnected(
    callback,
    options,
    resolve,
    reject,
    dontRelease,
    distributed,
    err,
    pooledConnection,
  ) {
    /*
    BEGIN; -- works on POSTGRES, MySQL (autocommit is true, no options accepted), and SQLite (no options accepted) (need to change to BEGIN TRANSACTION on MSSQL)
    START TRANSACTION; -- works on POSTGRES, MySQL (autocommit is false, options accepted), (need to change to BEGIN TRANSACTION on MSSQL and BEGIN on SQLite)

    -- Create a SAVEPOINT
    SAVEPOINT my_savepoint; -- works on POSTGRES, MySQL, and SQLite (need to change to SAVE TRANSACTION on MSSQL)

    -- QUERY

    -- Roll back to SAVEPOINT if needed
    ROLLBACK TO SAVEPOINT my_savepoint; -- works on POSTGRES, MySQL, and SQLite (need to change to ROLLBACK TRANSACTION on MSSQL)

    -- Release the SAVEPOINT
    RELEASE SAVEPOINT my_savepoint; -- works on POSTGRES, MySQL, and SQLite (MSSQL dont have RELEASE SAVEPOINT you just need to transaction again)

    -- Commit the transaction
    COMMIT; -- works on POSTGRES, MySQL, and SQLite (need to change to COMMIT TRANSACTION on MSSQL)
    -- or rollback everything
    ROLLBACK; -- works on POSTGRES, MySQL, and SQLite (need to change to ROLLBACK TRANSACTION on MSSQL)

    */

    if (err) {
      return reject(err);
    }
    const state = {
      connectionState: ReservedConnectionState.acceptQueries,
      reject,
      queries: new Set(),
      readOnly: options?.toLowerCase() === "read" || options?.toLowerCase() === "readonly",
    };

    let savepoints = 0;
    let transactionSavepoints = new Set();

    // Use adapter methods to get transaction commands
    let BEGIN_COMMAND: string;
    let ROLLBACK_COMMAND: string;
    let COMMIT_COMMAND: string;
    let BEFORE_COMMIT_OR_ROLLBACK_COMMAND: string | null;

    // These are standard across most adapters, but could be overridden in the future
    let SAVEPOINT_COMMAND: string = "SAVEPOINT";
    let RELEASE_SAVEPOINT_COMMAND: string | null = "RELEASE SAVEPOINT";
    let ROLLBACK_TO_SAVEPOINT_COMMAND: string = "ROLLBACK TO SAVEPOINT";

    if (distributed) {
      if (options.indexOf("'") !== -1) {
        adapter.release(pooledConnection);
        return reject(new Error(`Distributed transaction name cannot contain single quotes.`));
      }

      // Check if adapter supports distributed transactions
      if (!adapter.supportsDistributedTransactions()) {
        adapter.release(pooledConnection);
        return reject(new Error(`${getAdapterDisplayName(resolvedOptions)} doesn't support distributed transactions`));
      }

      // Get distributed transaction commands from adapter
      BEGIN_COMMAND = adapter.getBeginCommand(undefined, options);
      COMMIT_COMMAND = adapter.getCommitCommand(options);
      ROLLBACK_COMMAND = adapter.getRollbackCommand(options);
      BEFORE_COMMIT_OR_ROLLBACK_COMMAND = adapter.getBeforeCommitOrRollbackCommand(options);
    } else {
      // Get normal transaction commands from adapter
      BEGIN_COMMAND = adapter.getBeginCommand(options);
      COMMIT_COMMAND = adapter.getCommitCommand();
      ROLLBACK_COMMAND = adapter.getRollbackCommand();
      BEFORE_COMMIT_OR_ROLLBACK_COMMAND = adapter.getBeforeCommitOrRollbackCommand();
    }
    const onClose = onTransactionDisconnected.bind(state);
    // SQLite doesn't have onClose method, only PostgreSQL does
    if (pooledConnection.onClose) {
      pooledConnection.onClose(onClose);
    }

    function run_internal_transaction_sql(string) {
      if (state.connectionState & ReservedConnectionState.closed) {
        return Promise.reject(connectionClosedError());
      }

      // Check if this is a write operation in a read-only transaction
      if (state.readOnly) {
        const upperString = string.trim().toUpperCase();
        const firstWord = upperString.split(/\s+/)[0];
        if (
          firstWord === "INSERT" ||
          firstWord === "UPDATE" ||
          firstWord === "DELETE" ||
          firstWord === "CREATE" ||
          firstWord === "DROP" ||
          firstWord === "ALTER" ||
          firstWord === "REPLACE" ||
          firstWord === "TRUNCATE"
        ) {
          return Promise.reject(new Error("attempt to write a readonly database"));
        }
      }

      return unsafeQueryFromTransaction(string, [], pooledConnection, state.queries);
    }
    function transaction_sql(strings, ...values) {
      if (
        state.connectionState & ReservedConnectionState.closed ||
        !(state.connectionState & ReservedConnectionState.acceptQueries)
      ) {
        return Promise.reject(connectionClosedError());
      }
      if ($isArray(strings)) {
        // detect if is tagged template
        if (!$isArray((strings as unknown as TemplateStringsArray).raw)) {
          return new SQLHelper(strings, values);
        }
      } else if (typeof strings === "object" && !(strings instanceof Query) && !(strings instanceof SQLHelper)) {
        return new SQLHelper([strings], values);
      }

      return queryFromTransaction(strings, values, pooledConnection, state.queries, state);
    }
    transaction_sql.unsafe = (string, args = []) => {
      // Check if this is a write operation in a read-only transaction
      if (state.readOnly) {
        const upperString = string.trim().toUpperCase();
        const firstWord = upperString.split(/\s+/)[0];
        if (
          firstWord === "INSERT" ||
          firstWord === "UPDATE" ||
          firstWord === "DELETE" ||
          firstWord === "CREATE" ||
          firstWord === "DROP" ||
          firstWord === "ALTER" ||
          firstWord === "REPLACE" ||
          firstWord === "TRUNCATE"
        ) {
          return Promise.reject(new Error("attempt to write a readonly database"));
        }
      }
      return unsafeQueryFromTransaction(string, args, pooledConnection, state.queries);
    };
    transaction_sql.file = async (path: string, args = []) => {
      return await Bun.file(path)
        .text()
        .then(text => {
          return unsafeQueryFromTransaction(text, args, pooledConnection, state.queries);
        });
    };
    // reserve is allowed to be called inside transaction connection but will return a new reserved connection from the pool and will not be part of the transaction
    // this matchs the behavior of the postgres package
    transaction_sql.reserve = () => sql.reserve();

    transaction_sql.connect = () => {
      if (state.connectionState & ReservedConnectionState.closed) {
        return Promise.reject(connectionClosedError());
      }

      return Promise.resolve(transaction_sql);
    };
    transaction_sql.commitDistributed = async function (name: string) {
      assertValidTransactionName(name);
      if (!adapter.supportsDistributedTransactions()) {
        throw Error(`${getAdapterDisplayName(resolvedOptions)} doesn't support distributed transactions`);
      }
      return await adapter.commitDistributed(name, run_internal_transaction_sql);
    };
    transaction_sql.rollbackDistributed = async function (name: string) {
      assertValidTransactionName(name);
      if (!adapter.supportsDistributedTransactions()) {
        throw Error(`${getAdapterDisplayName(resolvedOptions)} doesn't support distributed transactions`);
      }
      return await adapter.rollbackDistributed(name, run_internal_transaction_sql);
    };
    // begin is not allowed on a transaction we need to use savepoint() instead
    transaction_sql.begin = function () {
      if (distributed) {
        throw $ERR_POSTGRES_INVALID_TRANSACTION_STATE("cannot call begin inside a distributed transaction");
      }
      throw $ERR_POSTGRES_INVALID_TRANSACTION_STATE("cannot call begin inside a transaction use savepoint() instead");
    };

    transaction_sql.beginDistributed = function () {
      if (distributed) {
        throw $ERR_POSTGRES_INVALID_TRANSACTION_STATE("cannot call beginDistributed inside a distributed transaction");
      }
      throw $ERR_POSTGRES_INVALID_TRANSACTION_STATE(
        "cannot call beginDistributed inside a transaction use savepoint() instead",
      );
    };

    transaction_sql.flush = function () {
      if (state.connectionState & ReservedConnectionState.closed) {
        throw connectionClosedError();
      }
      return pooledConnection.flush();
    };
    transaction_sql.close = async function (options?: { timeout?: number }) {
      // we dont actually close the connection here, we just set the state to closed and rollback the transaction
      if (
        state.connectionState & ReservedConnectionState.closed ||
        !(state.connectionState & ReservedConnectionState.acceptQueries)
      ) {
        return Promise.resolve(undefined);
      }
      state.connectionState &= ~ReservedConnectionState.acceptQueries;
      const transactionQueries = state.queries;
      let timeout = options?.timeout;
      if (timeout) {
        timeout = Number(timeout);
        if (timeout > 2 ** 31 || timeout < 0 || timeout !== timeout) {
          throw $ERR_INVALID_ARG_VALUE("options.timeout", timeout, "must be a non-negative integer less than 2^31");
        }

        if (timeout > 0 && (transactionQueries.size > 0 || transactionSavepoints.size > 0)) {
          const { promise, resolve } = Promise.withResolvers();
          // race all queries vs timeout
          const pending_queries = Array.from(transactionQueries);
          const pending_savepoints = Array.from(transactionSavepoints);
          const timer = setTimeout(async () => {
            for (const query of transactionQueries) {
              (query as Query).cancel();
            }
            if (BEFORE_COMMIT_OR_ROLLBACK_COMMAND) {
              await run_internal_transaction_sql(BEFORE_COMMIT_OR_ROLLBACK_COMMAND);
            }
            await run_internal_transaction_sql(ROLLBACK_COMMAND);
            state.connectionState |= ReservedConnectionState.closed;
            resolve();
          }, timeout * 1000);
          timer.unref(); // dont block the event loop
          Promise.all([Promise.all(pending_queries), Promise.all(pending_savepoints)]).finally(() => {
            clearTimeout(timer);
            resolve();
          });
          return promise;
        }
      }
      for (const query of transactionQueries) {
        (query as Query).cancel();
      }
      if (BEFORE_COMMIT_OR_ROLLBACK_COMMAND) {
        await run_internal_transaction_sql(BEFORE_COMMIT_OR_ROLLBACK_COMMAND);
      }
      await run_internal_transaction_sql(ROLLBACK_COMMAND);
      state.connectionState |= ReservedConnectionState.closed;
    };
    transaction_sql[Symbol.asyncDispose] = () => transaction_sql.close();
    transaction_sql.options = sql.options;

    transaction_sql.transaction = transaction_sql.begin;
    transaction_sql.distributed = transaction_sql.beginDistributed;
    transaction_sql.end = transaction_sql.close;
    function onSavepointFinished(savepoint_promise: Promise<any>) {
      transactionSavepoints.delete(savepoint_promise);
    }
    async function run_internal_savepoint(save_point_name: string, savepoint_callback: TransactionCallback) {
      await run_internal_transaction_sql(`${SAVEPOINT_COMMAND} ${save_point_name}`);

      try {
        let result = await savepoint_callback(transaction_sql);
        if (RELEASE_SAVEPOINT_COMMAND) {
          // mssql dont have release savepoint
          await run_internal_transaction_sql(`${RELEASE_SAVEPOINT_COMMAND} ${save_point_name}`);
        }
        if ($isArray(result)) {
          result = await Promise.all(result);
        }
        return result;
      } catch (err) {
        if (!(state.connectionState & ReservedConnectionState.closed)) {
          await run_internal_transaction_sql(`${ROLLBACK_TO_SAVEPOINT_COMMAND} ${save_point_name}`);
        }
        throw err;
      }
    }
    if (distributed) {
      transaction_sql.savepoint = async (_fn: TransactionCallback, _name?: string): Promise<any> => {
        throw $ERR_POSTGRES_INVALID_TRANSACTION_STATE("cannot call savepoint inside a distributed transaction");
      };
    } else {
      transaction_sql.savepoint = async (fn: TransactionCallback, name?: string): Promise<any> => {
        let savepoint_callback = fn;

        if (
          state.connectionState & ReservedConnectionState.closed ||
          !(state.connectionState & ReservedConnectionState.acceptQueries)
        ) {
          throw connectionClosedError();
        }

        if ($isCallable(name)) {
          savepoint_callback = name as unknown as TransactionCallback;
          name = "";
        }
        if (!$isCallable(savepoint_callback)) {
          throw $ERR_INVALID_ARG_VALUE("fn", callback, "must be a function");
        }
        // matchs the format of the savepoint name in postgres package
        const save_point_name = `s${savepoints++}${name ? `_${name}` : ""}`;
        const promise = run_internal_savepoint(save_point_name, savepoint_callback);
        transactionSavepoints.add(promise);
        promise.finally(onSavepointFinished.bind(null, promise));
        return await promise;
      };
    }
    let needs_rollback = false;
    try {
      await run_internal_transaction_sql(BEGIN_COMMAND);
      needs_rollback = true;
      let transaction_result = await callback(transaction_sql);
      if ($isArray(transaction_result)) {
        transaction_result = await Promise.all(transaction_result);
      }
      // at this point we dont need to rollback anymore
      needs_rollback = false;
      if (BEFORE_COMMIT_OR_ROLLBACK_COMMAND) {
        await run_internal_transaction_sql(BEFORE_COMMIT_OR_ROLLBACK_COMMAND);
      }
      await run_internal_transaction_sql(COMMIT_COMMAND);
      return resolve(transaction_result);
    } catch (err) {
      try {
        if (!(state.connectionState & ReservedConnectionState.closed) && needs_rollback) {
          if (BEFORE_COMMIT_OR_ROLLBACK_COMMAND) {
            await run_internal_transaction_sql(BEFORE_COMMIT_OR_ROLLBACK_COMMAND);
          }
          await run_internal_transaction_sql(ROLLBACK_COMMAND);
        }
      } catch (err) {
        return reject(err);
      }
      return reject(err);
    } finally {
      state.connectionState |= ReservedConnectionState.closed;
      pooledConnection.queries.delete(onClose);
      if (!dontRelease) {
        adapter.release(pooledConnection);
      }
    }
  }

  function sql(strings: string | TemplateStringsArray | object, ...values: unknown[]) {
    if ($isArray(strings)) {
      if (!$isArray(strings.raw)) {
        return new SQLHelper(strings, values);
      }
    } else if (typeof strings === "object" && !(strings instanceof Query) && !(strings instanceof SQLHelper)) {
      return new SQLHelper([strings], values);
    }

    return queryFromPool(strings, values);
  }

  sql.unsafe = (string: string, args = []) => {
    return unsafeQuery(string, args);
  };

  sql.file = async (path: string, args = []) => {
    return await Bun.file(path)
      .text()
      .then(text => {
        return unsafeQuery(text, args);
      });
  };

  sql.reserve = () => {
    if (adapter.closed) {
      return Promise.reject(connectionClosedError());
    }
    return adapter.reserve(sql, onReserveConnected);
  };

  sql.rollbackDistributed = async function (name: string) {
    if (adapter.closed) {
      throw connectionClosedError();
    }

    assertValidTransactionName(name);

    if (!adapter.supportsDistributedTransactions()) {
      throw Error(`${getAdapterDisplayName(resolvedOptions)} doesn't support distributed transactions`);
    }

    return await adapter.rollbackDistributed(name, sql);
  };

  sql.commitDistributed = async function (name: string) {
    if (adapter.closed) {
      throw connectionClosedError();
    }

    assertValidTransactionName(name);

    if (!adapter.supportsDistributedTransactions()) {
      throw Error(`${getAdapterDisplayName(resolvedOptions)} doesn't support distributed transactions`);
    }

    return await adapter.commitDistributed(name, sql);
  };

  sql.beginDistributed = (name: string, fn: TransactionCallback) => {
    if (adapter.closed) {
      return Promise.reject(connectionClosedError());
    }

    let callback = fn;

    if (typeof name !== "string") {
      return Promise.reject($ERR_INVALID_ARG_VALUE("name", name, "must be a string"));
    }

    if (!$isCallable(callback)) {
      return Promise.reject($ERR_INVALID_ARG_VALUE("fn", callback, "must be a function"));
    }

    const { promise, resolve, reject } = Promise.withResolvers();

    // lets just reuse the same code path as the transaction begin
    adapter.connect(onTransactionConnected.bind(null, callback, name, resolve, reject, false, true), true);
    return promise;
  };

  sql.begin = (options_or_fn: string | TransactionCallback, fn?: TransactionCallback) => {
    if (adapter.closed) {
      return Promise.reject(connectionClosedError());
    }

    let callback = fn;
    let options: string | undefined = options_or_fn as unknown as string;
    if ($isCallable(options_or_fn)) {
      callback = options_or_fn as unknown as TransactionCallback;
      options = undefined;
    } else if (typeof options_or_fn !== "string") {
      return Promise.reject($ERR_INVALID_ARG_VALUE("options", options_or_fn, "must be a string"));
    }

    if (!$isCallable(callback)) {
      return Promise.reject($ERR_INVALID_ARG_VALUE("fn", callback, "must be a function"));
    }

    const { promise, resolve, reject } = Promise.withResolvers();
    adapter.connect(onTransactionConnected.bind(null, callback, options, resolve, reject, false, false), true);

    return promise;
  };

  sql.connect = () => {
    if (adapter.closed) {
      return Promise.reject(connectionClosedError());
    }

    if (adapter.isConnected()) {
      return Promise.resolve(sql);
    }

    const { resolve, reject, promise } = Promise.withResolvers();

    const onConnected = (err: unknown, connection: PooledPostgresConnection | null) => {
      if (err) {
        return reject(err);
      }

      // we are just measuring the connection here lets release it
      if (connection) {
        adapter.release(connection);
      }

      resolve(sql);
    };

    adapter.connect(onConnected);

    return promise;
  };

  sql.close = async (options?: { timeout?: number }) => {
    await adapter.close(options);
  };

  sql[Symbol.asyncDispose] = () => sql.close();

  sql.flush = () => adapter.flush();
  sql.options = resolvedOptions;

  sql.transaction = sql.begin;
  sql.distributed = sql.beginDistributed;
  sql.end = sql.close;

  return sql satisfies Bun.SQL;
};

SQL.UnsupportedAdapterError = UnsupportedAdapterError;

var lazyDefaultSQL: Bun.SQL;

function resetDefaultSQL(sql: Bun.SQL) {
  lazyDefaultSQL = sql;
  // this will throw "attempt to assign to readonly property"
  // Object.assign(defaultSQLObject, lazyDefaultSQL);
  // exportsObject.default = exportsObject.sql = lazyDefaultSQL;
}

function ensureDefaultSQL() {
  if (!lazyDefaultSQL) {
    resetDefaultSQL(SQL(undefined));
  }
}

const defaultSQLObject: Bun.SQL = function sql(strings, ...values) {
  if (new.target) {
    return SQL(strings);
  }

  if (!lazyDefaultSQL) {
    resetDefaultSQL(SQL(undefined));
  }

  return lazyDefaultSQL(strings, ...values);
} as Bun.SQL;

defaultSQLObject.reserve = (...args) => {
  ensureDefaultSQL();
  return lazyDefaultSQL.reserve(...args);
};

defaultSQLObject.commitDistributed = (...args) => {
  ensureDefaultSQL();
  return lazyDefaultSQL.commitDistributed(...args);
};

defaultSQLObject.rollbackDistributed = (...args) => {
  ensureDefaultSQL();
  return lazyDefaultSQL.rollbackDistributed(...args);
};

defaultSQLObject.distributed = defaultSQLObject.beginDistributed = (...args) => {
  ensureDefaultSQL();
  return lazyDefaultSQL.beginDistributed(...args);
};

defaultSQLObject.connect = (...args) => {
  ensureDefaultSQL();
  return lazyDefaultSQL.connect(...args);
};

defaultSQLObject.unsafe = (...args) => {
  ensureDefaultSQL();
  return lazyDefaultSQL.unsafe(...args);
};

defaultSQLObject.file = (filename: string, ...args) => {
  ensureDefaultSQL();
  return lazyDefaultSQL.file(filename, ...args);
};

defaultSQLObject.transaction = defaultSQLObject.begin = function (...args) {
  ensureDefaultSQL();
  return lazyDefaultSQL.begin(...args);
};

defaultSQLObject.end = defaultSQLObject.close = (...args) => {
  ensureDefaultSQL();
  return lazyDefaultSQL.close(...args);
};

defaultSQLObject.flush = (...args) => {
  ensureDefaultSQL();
  return lazyDefaultSQL.flush(...args);
};

//define lazy properties
defineProperties(defaultSQLObject, {
  options: {
    get: () => {
      ensureDefaultSQL();
      return lazyDefaultSQL.options;
    },
  },
  [Symbol.asyncDispose]: {
    get: () => {
      ensureDefaultSQL();
      return lazyDefaultSQL[Symbol.asyncDispose];
    },
  },
});

export default {
  sql: defaultSQLObject,
  default: defaultSQLObject,
  SQL,
  Query,
  postgres: SQL,
};
