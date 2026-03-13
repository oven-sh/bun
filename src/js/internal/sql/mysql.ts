import type { MySQLErrorOptions } from "internal/sql/errors";
import type { Query } from "./query";
import type { ArrayType, DatabaseAdapter, SQLArrayParameter, SQLHelper, SQLResultArray, SSLMode } from "./shared";
const { SQLHelper, SSLMode, SQLResultArray, buildDefinedColumnsAndQuery } = require("internal/sql/shared");
const {
  Query,
  SQLQueryFlags,
  symbols: { _strings, _values, _flags, _results, _handle },
} = require("internal/sql/query");
const { MySQLError } = require("internal/sql/errors");

const {
  createConnection: createMySQLConnection,
  createQuery: createMySQLQuery,
  init: initMySQL,
} = $zig("mysql.zig", "createBinding") as MySQLDotZig;

function wrapError(error: Error | MySQLErrorOptions) {
  if (Error.isError(error)) {
    return error;
  }
  return new MySQLError(error.message, error);
}
initMySQL(
  function onResolveMySQLQuery(query, result, commandTag, count, queries, is_last, last_insert_rowid, affected_rows) {
    /// simple queries
    if (query[_flags] & SQLQueryFlags.simple) {
      $assert(result instanceof SQLResultArray, "Invalid result array");
      // prepare for next query
      query[_handle].setPendingValue(new SQLResultArray());

      result.count = count || 0;
      result.lastInsertRowid = last_insert_rowid;
      result.affectedRows = affected_rows || 0;
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
      }
      return;
    }
    /// prepared statements
    $assert(result instanceof SQLResultArray, "Invalid result array");

    result.count = count || 0;
    result.lastInsertRowid = last_insert_rowid;
    result.affectedRows = affected_rows || 0;
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

  function onRejectMySQLQuery(query: Query<any, any>, reject: Error | MySQLErrorOptions, queries: Query<any, any>[]) {
    reject = wrapError(reject);
    if (queries) {
      const queriesIndex = queries.indexOf(query);
      if (queriesIndex !== -1) {
        queries.splice(queriesIndex, 1);
      }
    }

    try {
      query.reject(reject as Error);
    } catch {}
  },
);

export interface MySQLDotZig {
  init: (
    onResolveQuery: (
      query: Query<any, any>,
      result: SQLResultArray,
      commandTag: string,
      count: number,
      queries: any,
      is_last: boolean,
    ) => void,
    onRejectQuery: (query: Query<any, any>, err: Error, queries) => void,
  ) => void;
  createConnection: (
    hostname: string | undefined,
    port: number,
    username: string,
    password: string,
    databae: string,
    sslmode: SSLMode,
    tls: Bun.TLSOptions | boolean | null | Bun.BunFile, // boolean true => empty TLSOptions object `{}`, boolean false or null => nothing
    query: string,
    path: string,
    onConnected: (err: Error | null, connection: $ZigGeneratedClasses.MySQLConnection) => void,
    onDisconnected: (err: Error | null, connection: $ZigGeneratedClasses.MySQLConnection) => void,
    idleTimeout: number,
    connectionTimeout: number,
    maxLifetime: number,
    useUnnamedPreparedStatements: boolean,
  ) => $ZigGeneratedClasses.MySQLConnection;
  createQuery: (
    sql: string,
    values: unknown[],
    pendingValue: SQLResultArray,
    columns: string[] | undefined,
    bigint: boolean,
    simple: boolean,
  ) => $ZigGeneratedClasses.MySQLQuery;
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

function detectCommand(query: string): SQLCommand {
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
      case "any":
      case "all":
        return SQLCommand.in;
      default:
        return SQLCommand.none;
    }
  }
  return command;
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

function onQueryFinish(this: PooledMySQLConnection, onClose: (err: Error) => void) {
  this.queries.delete(onClose);
  this.adapter.release(this);
}

function closeNT(onClose: (err: Error) => void, err: Error | null) {
  onClose(err as Error);
}
class PooledMySQLConnection {
  private static async createConnection(
    options: Bun.SQL.__internal.DefinedPostgresOrMySQLOptions,
    onConnected: (err: Error | null, connection: $ZigGeneratedClasses.MySQLConnection) => void,
    onClose: (err: Error | null) => void,
  ): Promise<$ZigGeneratedClasses.MySQLConnection | null> {
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
    } = options;

    let password: Bun.MaybePromise<string> | string | undefined | (() => Bun.MaybePromise<string>) = options.password;

    try {
      if (typeof password === "function") {
        password = password();
      }

      if (password && $isPromise(password)) {
        password = await password;
      }

      return createMySQLConnection(
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
      );
    } catch (e) {
      process.nextTick(closeNT, onClose, e);
      return null;
    }
  }

  adapter: MySQLAdapter;
  connection: $ZigGeneratedClasses.MySQLConnection | null = null;
  state: PooledConnectionState = PooledConnectionState.pending;
  storedError: Error | null = null;
  queries: Set<(err: Error) => void> = new Set();
  onFinish: ((err: Error | null) => void) | null = null;
  connectionInfo: Bun.SQL.__internal.DefinedPostgresOrMySQLOptions;
  flags: number = 0;
  /// queryCount is used to indicate the number of queries using the connection, if a connection is reserved or if its a transaction queryCount will be 1 independently of the number of queries
  queryCount: number = 0;

  #onConnected(err, connection) {
    if (err) {
      err = wrapError(err);
    } else {
      this.connection = connection;
    }

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
    this.adapter.release(this, true);
  }

  #onClose(err) {
    if (err) {
      err = wrapError(err);
    }
    const connectionInfo = this.connectionInfo;
    if (connectionInfo?.onclose) {
      connectionInfo.onclose(err);
    }
    this.state = PooledConnectionState.closed;
    this.connection = null;
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

  constructor(connectionInfo: Bun.SQL.__internal.DefinedMySQLOptions, adapter: MySQLAdapter) {
    this.state = PooledConnectionState.pending;
    this.adapter = adapter;
    this.connectionInfo = connectionInfo;
    this.#startConnection();
  }

  #startConnection() {
    PooledMySQLConnection.createConnection(this.connectionInfo, this.#onConnected.bind(this), this.#onClose.bind(this));
  }

  onClose(onClose: (err: Error) => void) {
    this.queries.add(onClose);
  }

  bindQuery(query: Query<any, any>, onClose: (err: Error) => void) {
    this.queries.add(onClose);
    query.finally(onQueryFinish.bind(this, onClose));
  }

  #doRetry() {
    if (this.adapter.closed) {
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
    if (this.adapter.closed) {
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
        case "ERR_MYSQL_PASSWORD_REQUIRED":
        case "ERR_MYSQL_MISSING_AUTH_DATA":
        case "ERR_MYSQL_FAILED_TO_ENCRYPT_PASSWORD":
        case "ERR_MYSQL_INVALID_PUBLIC_KEY":
        case "ERR_MYSQL_UNSUPPORTED_PROTOCOL_VERSION":
        case "ERR_MYSQL_UNSUPPORTED_AUTH_PLUGIN":
        case "ERR_MYSQL_AUTHENTICATION_FAILED":
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

class MySQLAdapter
  implements
    DatabaseAdapter<PooledMySQLConnection, $ZigGeneratedClasses.MySQLConnection, $ZigGeneratedClasses.MySQLQuery>
{
  public readonly connectionInfo: Bun.SQL.__internal.DefinedPostgresOrMySQLOptions;

  public readonly connections: PooledMySQLConnection[];
  public readonly readyConnections: Set<PooledMySQLConnection> = new Set();

  public waitingQueue: Array<(err: Error | null, result: any) => void> = [];
  public reservedQueue: Array<(err: Error | null, result: any) => void> = [];

  public poolStarted: boolean = false;
  public closed: boolean = false;
  public totalQueries: number = 0;
  public onAllQueriesFinished: (() => void) | null = null;

  constructor(connectionInfo: Bun.SQL.__internal.DefinedPostgresOrMySQLOptions) {
    this.connectionInfo = connectionInfo;
    this.connections = new Array(connectionInfo.max);
  }

  escapeIdentifier(str: string) {
    return "`" + str.replaceAll("`", "``") + "`";
  }

  connectionClosedError() {
    return new MySQLError("Connection closed", {
      code: "ERR_MYSQL_CONNECTION_CLOSED",
    });
  }
  notTaggedCallError() {
    return new MySQLError("Query not called as a tagged template literal", {
      code: "ERR_MYSQL_NOT_TAGGED_CALL",
    });
  }
  queryCancelledError() {
    return new MySQLError("Query cancelled", {
      code: "ERR_MYSQL_QUERY_CANCELLED",
    });
  }
  invalidTransactionStateError(message: string) {
    return new MySQLError(message, {
      code: "ERR_MYSQL_INVALID_TRANSACTION_STATE",
    });
  }
  supportsReservedConnections() {
    return true;
  }

  getConnectionForQuery(pooledConnection: PooledMySQLConnection) {
    return pooledConnection.connection;
  }

  attachConnectionCloseHandler(connection: PooledMySQLConnection, handler: () => void): void {
    if (connection.onClose) {
      connection.onClose(handler);
    }
  }

  detachConnectionCloseHandler(connection: PooledMySQLConnection, handler: () => void): void {
    if (connection.queries) {
      connection.queries.delete(handler);
    }
  }
  array(_values: any[], _typeNameOrID?: number | ArrayType): SQLArrayParameter {
    throw new Error("MySQL doesn't support arrays");
  }
  getTransactionCommands(options?: string): import("./shared").TransactionCommands {
    let BEGIN = "START TRANSACTION";
    if (options) {
      BEGIN = `START TRANSACTION ${options}`;
    }

    return {
      BEGIN,
      COMMIT: "COMMIT",
      ROLLBACK: "ROLLBACK",
      SAVEPOINT: "SAVEPOINT",
      RELEASE_SAVEPOINT: "RELEASE SAVEPOINT",
      ROLLBACK_TO_SAVEPOINT: "ROLLBACK TO SAVEPOINT",
    };
  }

  getDistributedTransactionCommands(name: string): import("./shared").TransactionCommands | null {
    if (!this.validateDistributedTransactionName(name).valid) {
      return null;
    }

    return {
      BEGIN: `XA START '${name}'`,
      COMMIT: `XA PREPARE '${name}'`,
      ROLLBACK: `XA ROLLBACK '${name}'`,
      SAVEPOINT: "SAVEPOINT",
      RELEASE_SAVEPOINT: "RELEASE SAVEPOINT",
      ROLLBACK_TO_SAVEPOINT: "ROLLBACK TO SAVEPOINT",
      BEFORE_COMMIT_OR_ROLLBACK: `XA END '${name}'`,
    };
  }

  validateTransactionOptions(_options: string): { valid: boolean; error?: string } {
    return { valid: true };
  }

  validateDistributedTransactionName(name: string): { valid: boolean; error?: string } {
    if (name.indexOf("'") !== -1) {
      return {
        valid: false,
        error: "Distributed transaction name cannot contain single quotes.",
      };
    }
    return { valid: true };
  }

  getCommitDistributedSQL(name: string): string {
    const validation = this.validateDistributedTransactionName(name);
    if (!validation.valid) {
      throw new Error(validation.error);
    }
    return `XA COMMIT '${name}'`;
  }

  getRollbackDistributedSQL(name: string): string {
    const validation = this.validateDistributedTransactionName(name);
    if (!validation.valid) {
      throw new Error(validation.error);
    }
    return `XA ROLLBACK '${name}'`;
  }

  createQueryHandle(sql: string, values: unknown[], flags: number) {
    if (!(flags & SQLQueryFlags.allowUnsafeTransaction)) {
      if (this.connectionInfo.max !== 1) {
        const upperCaseSqlString = sql.toUpperCase().trim();
        if (upperCaseSqlString.startsWith("BEGIN") || upperCaseSqlString.startsWith("START TRANSACTION")) {
          throw new MySQLError("Only use sql.begin, sql.reserved or max: 1", {
            code: "ERR_MYSQL_UNSAFE_TRANSACTION",
          });
        }
      }
    }

    return createMySQLQuery(
      sql,
      values,
      new SQLResultArray(),
      undefined,
      !!(flags & SQLQueryFlags.bigint),
      !!(flags & SQLQueryFlags.simple),
    );
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

  release(connection: PooledMySQLConnection, connectingEvent: boolean = false) {
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
        if (connection.state === PooledConnectionState.connected) {
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
      const firstConnection = new PooledMySQLConnection(this.connectionInfo, this);
      this.connections[0] = firstConnection;
      if (reserved) {
        firstConnection.flags |= PooledConnectionFlags.preReserved; // lets pre reserve the first connection
      }
      for (let i = 1; i < pollSize; i++) {
        this.connections[i] = new PooledMySQLConnection(this.connectionInfo, this);
      }
      return;
    }
    if (reserved) {
      let connectionWithLeastQueries: PooledMySQLConnection | null = null;
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

  normalizeQuery(strings: string | TemplateStringsArray, values: unknown[], binding_idx = 1): [string, unknown[]] {
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
            const q = value as Query<any, any>;
            const [sub_query, sub_values] = this.normalizeQuery(q[_strings], q[_values], binding_idx);

            query += sub_query;
            for (let j = 0; j < sub_values.length; j++) {
              binding_values.push(sub_values[j]);
            }
            binding_idx += sub_values.length;
          } else if (value instanceof SQLHelper) {
            const command = detectCommand(query);
            // only selectIn, insert, update, updateSet are allowed
            if (command === SQLCommand.none || command === SQLCommand.where) {
              throw new SyntaxError("Helpers are only allowed for INSERT, UPDATE and IN commands");
            }
            const { columns, value: items } = value as SQLHelper;
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
                this.escapeIdentifier.bind(this),
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
                    query += `?${k < lastDefinedColumnIndex ? ", " : ""}`;
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
                  query += `?${j < lastDefinedColumnIndex ? ", " : ""}`;
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
                query += `?${j < lastItemIndex ? ", " : ""}`;
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
              // no need to include if is updateSet or upsert
              const isUpsert = query.trimEnd().endsWith("ON DUPLICATE KEY UPDATE");
              if (command === SQLCommand.update && !isUpsert) {
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
                query += `${this.escapeIdentifier(column)} = ?${i < lastColumnIndex ? ", " : ""}`;
                binding_values.push(columnValue);
              }
              if (query.endsWith(", ")) {
                // we got an undefined value at the end, lets remove the last comma
                query = query.substring(0, query.length - 2);
              }
              if (!hasValues) {
                throw new SyntaxError("Update needs to have at least one column");
              }
              query += " "; // the user can add where clause after this
            }
          } else {
            //TODO: handle sql.array parameters
            query += `? `;
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
}

export default {
  MySQLAdapter,
  commandToString,
  detectCommand,
  SQLCommand,
};
