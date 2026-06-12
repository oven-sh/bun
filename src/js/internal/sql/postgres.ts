import type { PostgresErrorOptions } from "internal/sql/errors";
import type { Query } from "./query";
import type { ArrayType, DatabaseAdapter, SQLArrayParameter, SQLCommand, SQLResultArray, SSLMode } from "./shared";
const {
  SQLResultArray,
  SQLArrayParameter,
  BasePooledConnection,
  BaseSQLAdapter,
  createPooledConnectionHandle,
  getHelperCommandFromDetect,
  pushBindParam,
} = require("internal/sql/shared");
const {
  SQLQueryFlags,
  symbols: { _results, _handle },
} = require("internal/sql/query");
function isTypedArray(value: any) {
  // Buffer should be treated as a normal object
  // Typed arrays should be treated like an array
  return ArrayBuffer.isView(value) && !Buffer.isBuffer(value);
}

const { PostgresError } = require("internal/sql/errors");

const {
  createConnection: createPostgresConnection,
  createQuery: createPostgresQuery,
  init: initPostgres,
} = $zig("postgres.zig", "createBinding") as PostgresDotZig;

const cmds = ["", "INSERT", "DELETE", "UPDATE", "MERGE", "SELECT", "MOVE", "FETCH", "COPY"];

const escapeBackslash = /\\/g;
const escapeQuote = /"/g;

function arrayEscape(value: string) {
  return value.replace(escapeBackslash, "\\\\").replace(escapeQuote, '\\"');
}
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

function isPostgresNumericType(type: string) {
  switch (type) {
    case "BIT": // bit_array
    case "VARBIT": // varbit_array
    case "SMALLINT": // int2_array
    case "INT2VECTOR": // int2vector_array
    case "INTEGER": // int4_array
    case "INT": // int4_array
    case "BIGINT": // int8_array
    case "REAL": // float4_array
    case "DOUBLE PRECISION": // float8_array
    case "NUMERIC": // numeric_array
    case "MONEY": // money_array
      return true;
    default:
      return false;
  }
}
function isPostgresJsonType(type: string) {
  switch (type) {
    case "JSON":
    case "JSONB":
      return true;
    default:
      return false;
  }
}
function getPostgresArrayType(typeId: number) {
  return POSTGRES_ARRAY_TYPES[typeId] || null;
}

function arrayValueSerializer(type: ArrayType, is_numeric: boolean, is_json: boolean, value: any) {
  // we do minimal to none type validation, we just try to format nicely and let the server handle if is valid SQL
  // postgres will try to convert string -> array type
  // postgres will emit a nice error saying what value dont have the expected format outputing the value in the error
  if ($isArray(value) || isTypedArray(value)) {
    if (!value.length) return "{}";
    const delimiter = type === "BOX" ? ";" : ",";
    return `{${value.map(arrayValueSerializer.bind(this, type, is_numeric, is_json)).join(delimiter)}}`;
  }

  switch (typeof value) {
    case "undefined":
      return "null";
    case "string":
      if (is_json) {
        return `"${arrayEscape(JSON.stringify(value))}"`;
      }
      return `"${arrayEscape(value)}"`;

    case "bigint":
    case "number":
      if (is_numeric || is_json) {
        return "" + value;
      }
      return `"${value}"`;
    case "boolean":
      switch (type) {
        case "BOOLEAN":
          return value === true ? "t" : "f";
        case "JSON":
        case "JSONB":
          return value === true ? "true" : "false";
        default:
          if (is_numeric) {
            // convert to int if is a numeric array
            return "" + (value ? 1 : 0);
          }
          // fallback to string
          return value === true ? '"true"' : '"false"';
      }
    default:
      if (value instanceof Date) {
        const isoValue = value.toISOString();
        if (is_json) {
          return `"${arrayEscape(JSON.stringify(isoValue))}"`;
        }
        return `"${arrayEscape(isoValue)}"`;
      }
      if (Buffer.isBuffer(value)) {
        const hexValue = value.toString("hex");
        // bytea array
        if (type === "BYTEA") {
          return `"\\x${arrayEscape(hexValue)}"`;
        }
        if (is_json) {
          return `"${arrayEscape(JSON.stringify(hexValue))}"`;
        }
        return `"${arrayEscape(hexValue)}"`;
      }
      // fallback to JSON.stringify
      return `"${arrayEscape(JSON.stringify(value))}"`;
  }
}
function getArrayType(typeNameOrID: number | ArrayType | undefined = undefined): ArrayType {
  const typeOfType = typeof typeNameOrID;
  if (typeOfType === "number") {
    return getPostgresArrayType(typeNameOrID as number) ?? "JSON";
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
  // default to JSON so we accept most of the types
  return "JSON";
}
function serializeArray(values: any[], type: ArrayType) {
  if (!$isArray(values) && !isTypedArray(values)) return values;

  if (!values.length) return "{}";

  // Only _box (1020) has the ';' delimiter for arrays, all other types use the ',' delimiter
  const delimiter = type === "BOX" ? ";" : ",";

  return `{${values.map(arrayValueSerializer.bind(this, type, isPostgresNumericType(type), isPostgresJsonType(type))).join(delimiter)}}`;
}

function wrapPostgresError(error: Error | PostgresErrorOptions) {
  if (Error.isError(error)) {
    return error;
  }
  return new PostgresError(error.message, error);
}

initPostgres(
  function onResolvePostgresQuery(query, result, commandTag, count, queries, is_last) {
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
  },

  function onRejectPostgresQuery(
    query: Query<any, any>,
    reject: Error | PostgresErrorOptions,
    queries: Query<any, any>[],
  ) {
    reject = wrapPostgresError(reject);
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

export interface PostgresDotZig {
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
}

class PooledPostgresConnection extends BasePooledConnection<$ZigGeneratedClasses.PostgresSQLConnection> {
  protected async startConnection() {
    this.connection = await createPooledConnectionHandle(
      createPostgresConnection,
      this.connectionInfo,
      this.handleConnected.bind(this),
      this.handleClose.bind(this),
    );
  }

  protected wrapError(error: any): Error {
    return wrapPostgresError(error);
  }

  protected isNonRetryableError(code: string | undefined): boolean {
    switch (code) {
      case "ERR_POSTGRES_UNSUPPORTED_AUTHENTICATION_METHOD":
      case "ERR_POSTGRES_UNKNOWN_AUTHENTICATION_METHOD":
      case "ERR_POSTGRES_TLS_NOT_AVAILABLE":
      case "ERR_POSTGRES_TLS_UPGRADE_FAILED":
      case "ERR_POSTGRES_INVALID_SERVER_SIGNATURE":
      case "ERR_POSTGRES_INVALID_SERVER_KEY":
      case "ERR_POSTGRES_AUTHENTICATION_FAILED_PBKDF2":
        // we can't retry these are authentication errors
        return true;
      default:
        return false;
    }
  }

  /// Connect failures (ERR_POSTGRES_CONNECTION_FAILED) mean the server
  /// accepted the TCP connection but closed it before the handshake
  /// completed, typically because it is still starting up or an intermediary
  /// (like a container port proxy) is up before the database is. Those are
  /// retried until connectionTimeout elapses, as long as queries are waiting
  /// on the pool. Refused connections (ERR_POSTGRES_CONNECTION_REFUSED) fail
  /// fast: nothing is listening, and probes/healthchecks rely on the
  /// immediate error. Real server errors (authentication, ErrorResponse
  /// during startup) and closes of established connections are not retried
  /// here.
  protected isConnectFailureError(err: Error | null): boolean {
    return err instanceof PostgresError && (err as any).code === "ERR_POSTGRES_CONNECTION_FAILED";
  }
}

class PostgresAdapter
  extends BaseSQLAdapter<
    PooledPostgresConnection,
    $ZigGeneratedClasses.PostgresSQLConnection,
    $ZigGeneratedClasses.PostgresSQLQuery
  >
  implements
    DatabaseAdapter<
      PooledPostgresConnection,
      $ZigGeneratedClasses.PostgresSQLConnection,
      $ZigGeneratedClasses.PostgresSQLQuery
    >
{
  protected createPooledConnection(): PooledPostgresConnection {
    return new PooledPostgresConnection(this.connectionInfo, this);
  }

  escapeIdentifier(str: string) {
    return '"' + str.replaceAll('"', '""').replaceAll(".", '"."') + '"';
  }

  connectionClosedError() {
    return new PostgresError("Connection closed", {
      code: "ERR_POSTGRES_CONNECTION_CLOSED",
    });
  }
  notTaggedCallError() {
    return new PostgresError("Query not called as a tagged template literal", {
      code: "ERR_POSTGRES_NOT_TAGGED_CALL",
    });
  }
  queryCancelledError(): Error {
    return new PostgresError("Query cancelled", {
      code: "ERR_POSTGRES_QUERY_CANCELLED",
    });
  }
  invalidTransactionStateError(message: string) {
    return new PostgresError(message, {
      code: "ERR_POSTGRES_INVALID_TRANSACTION_STATE",
    });
  }
  unsafeTransactionError() {
    return new PostgresError("Only use sql.begin, sql.reserved or max: 1", {
      code: "ERR_POSTGRES_UNSAFE_TRANSACTION",
    });
  }

  array(values: any[], typeNameOrID?: number | ArrayType): SQLArrayParameter {
    const arrayType = getArrayType(typeNameOrID);
    return new SQLArrayParameter(serializeArray(values, arrayType), arrayType);
  }

  getTransactionCommands(options?: string): import("./shared").TransactionCommands {
    let BEGIN = "BEGIN";
    if (options) {
      BEGIN = `BEGIN ${options}`;
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
      BEGIN: "BEGIN",
      COMMIT: `PREPARE TRANSACTION '${name}'`,
      ROLLBACK: "ROLLBACK",
      SAVEPOINT: "SAVEPOINT",
      RELEASE_SAVEPOINT: "RELEASE SAVEPOINT",
      ROLLBACK_TO_SAVEPOINT: "ROLLBACK TO SAVEPOINT",
      BEFORE_COMMIT_OR_ROLLBACK: null,
    };
  }

  getCommitDistributedSQL(name: string): string {
    const validation = this.validateDistributedTransactionName(name);
    if (!validation.valid) {
      throw new Error(validation.error);
    }
    return `COMMIT PREPARED '${name}'`;
  }

  getRollbackDistributedSQL(name: string): string {
    const validation = this.validateDistributedTransactionName(name);
    if (!validation.valid) {
      throw new Error(validation.error);
    }
    return `ROLLBACK PREPARED '${name}'`;
  }

  createQueryHandle(sql: string, values: unknown[], flags: number) {
    this.checkUnsafeTransaction(sql, flags);

    return createPostgresQuery(
      sql,
      values,
      new SQLResultArray(),
      undefined,
      !!(flags & SQLQueryFlags.bigint),
      !!(flags & SQLQueryFlags.simple),
    );
  }

  getHelperCommand(query: string): SQLCommand {
    return getHelperCommandFromDetect(query, false);
  }

  placeholder(index: number): string {
    return "$" + index;
  }

  bindParam(value: unknown, binding_values: unknown[], index: number): string {
    if (value instanceof SQLArrayParameter) {
      binding_values.push(value.serializedValues);
      return `$${index}::${value.arrayType}[] `;
    }
    return pushBindParam(this, value, binding_values, index);
  }

  // --- LISTEN/NOTIFY ---
  // A single dedicated connection is created and reused for all listeners
  // on this adapter. It reconnects automatically with exponential backoff
  // (250ms → 32s) when the connection drops, and re-issues LISTEN for every
  // tracked channel. notify() goes through the regular pool via pg_notify().

  #listenConnection: $ZigGeneratedClasses.PostgresSQLConnection | null = null;
  #listenConnectPromise: Promise<$ZigGeneratedClasses.PostgresSQLConnection> | null = null;
  // Per-channel listener sets. The presence of a key means LISTEN should be
  // active for that channel on the dedicated connection.
  #listenChannels: Map<string, Set<(payload: string) => void>> = new Map();
  // Per-channel onlisten callbacks (fired on every successful LISTEN ack,
  // including reconnects), keyed by the onnotify they were registered with so
  // unlisten(channel, onnotify) removes the paired onlisten too.
  #listenOnlistenCallbacks: Map<
    string,
    Map<(payload: string) => void, Set<(state: { pid: number; secret: number }) => void>>
  > = new Map();
  // Shared by concurrent listen() calls on the same channel so they all await
  // the same LISTEN ack instead of skipping it and resolving early.
  #listenInFlight: Map<string, Promise<void>> = new Map();
  #listenReconnectDelay: number = 250;
  #listenReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Track consecutive per-channel LISTEN failures during reconnect. A channel
  // that fails this many times in a row is dropped to avoid an infinite retry
  // loop on a permanently-misconfigured channel.
  #listenChannelFailures: Map<string, number> = new Map();
  readonly #listenMaxChannelFailures: number = 10;
  // Shared state object returned from every listen() call. The same reference
  // is handed out to all listeners and mutated in-place on each (re)connect, so
  // user code holding `state` from a stale listen() always sees current pid/secret.
  // This matches the postgres.js `state.pid` shape but with auto-update semantics.
  #listenState: { pid: number; secret: number } = { pid: 0, secret: 0 };

  #closeListen() {
    if (this.#listenReconnectTimer) {
      clearTimeout(this.#listenReconnectTimer);
      this.#listenReconnectTimer = null;
    }
    const conn = this.#listenConnection;
    this.#listenConnection = null;
    // The in-flight create promise self-clears via .finally(), but null it here
    // for symmetry so post-close synchronous reads don't see a stale promise.
    this.#listenConnectPromise = null;
    this.#listenChannels.clear();
    this.#listenOnlistenCallbacks.clear();
    this.#listenChannelFailures.clear();
    this.#listenInFlight.clear();
    this.#listenReconnectDelay = 250;
    // Intentionally do NOT zero #listenState here — user code holding a `state`
    // reference from a previous listen() should be able to inspect the last-known
    // pid/secret after close (e.g. to log "shut down on backend N"). The next
    // (re)connect overwrites these in place.
    if (conn) {
      try {
        conn.close();
      } catch {}
    }
  }

  // BaseSQLAdapter.close() calls this after validating its arguments and
  // marking the pool closed, so an invalid timeout cannot tear down the
  // LISTEN state and an in-flight listen connect sees `closed` and rejects.
  protected closeDedicatedConnections(): void {
    this.#closeListen();
  }

  async #createListenConnection(): Promise<$ZigGeneratedClasses.PostgresSQLConnection> {
    if (this.closed) throw this.connectionClosedError();

    const { promise, resolve, reject } = Promise.withResolvers<$ZigGeneratedClasses.PostgresSQLConnection>();
    let connected = false;
    // The shared helper resolves the password and marshals the native
    // createConnection arguments; the overrides pin the dedicated listen
    // connection open (never idle out, never recycle) and keep prepared
    // statements named (only LISTEN/UNLISTEN run here).
    createPooledConnectionHandle(
      createPostgresConnection,
      { ...this.connectionInfo, idleTimeout: 0, maxLifetime: 0, prepare: true },
      (err, conn) => {
        if (err) {
          reject(wrapPostgresError(err));
          return;
        }
        // If close() ran while the native side was connecting, the adapter
        // is gone — close the orphan connection rather than leaking it.
        if (this.closed) {
          try {
            conn.close();
          } catch {}
          reject(this.connectionClosedError());
          return;
        }
        connected = true;
        this.#listenConnection = conn;
        this.#listenReconnectDelay = 250;
        // Mutate the shared #listenState in place so every previously-returned
        // listen() result sees the new connection's pid/secret on reconnect.
        const connWithIds = conn as unknown as { processId: number; secretKey: number };
        this.#listenState.pid = connWithIds.processId;
        this.#listenState.secret = connWithIds.secretKey;
        // Generated `.d.ts` marks `onnotification` readonly because the codegen
        // produces a getter regardless of setter presence (same for onclose/onconnect).
        // The native setter exists; cast through a writable shape rather than `any`.
        (conn as { onnotification: (channel: string, payload: string) => void }).onnotification = (
          channel: string,
          payload: string,
        ) => this.#dispatchNotification(channel, payload);
        conn.ref();
        resolve(conn);
      },
      err => {
        this.#listenConnection = null;
        if (!connected) {
          // Errors before the first successful connect (including password
          // resolution failures caught inside the shared helper) must reject
          // the pending listen() instead of scheduling a reconnect.
          reject(wrapPostgresError(err ?? this.connectionClosedError()));
          return;
        }
        this.#scheduleListenReconnect();
      },
    );
    return promise;
  }

  async #ensureListenConnection(): Promise<$ZigGeneratedClasses.PostgresSQLConnection> {
    if (this.#listenConnection) return this.#listenConnection;
    if (!this.#listenConnectPromise) {
      this.#listenConnectPromise = this.#createListenConnection().finally(() => {
        this.#listenConnectPromise = null;
      });
    }
    return this.#listenConnectPromise;
  }

  #dispatchNotification(channel: string, payload: string) {
    const listeners = this.#listenChannels.get(channel);
    if (!listeners) return;
    for (const fn of listeners) {
      try {
        fn.$call(undefined, payload);
      } catch {}
    }
  }

  #scheduleListenReconnect() {
    // Reconnect retries indefinitely as long as there are tracked channels and
    // the adapter is open. There is no global attempt cap — if PG is permanently
    // down, this will keep firing every ≤32s forever (capped delay below). Stops
    // immediately when:
    //   - the adapter is closed (#closeListen clears channels and the timer), or
    //   - the last channel is unlistened (#listenChannels becomes empty), or
    //   - all permanently-failing channels exceed #listenMaxChannelFailures and get
    //     dropped, draining #listenChannels.
    // This matches postgres.js, which also retries indefinitely.
    if (this.closed || this.#listenChannels.size === 0 || this.#listenReconnectTimer) return;
    // Apply ±25% jitter (multiplier in [0.75, 1.25]) to the base delay to avoid
    // synchronized retry storms when many adapters in the same process lose their
    // listen connection at once.
    const jitter = 0.75 + Math.random() * 0.5;
    const delayMs = Math.max(1, Math.floor(this.#listenReconnectDelay * jitter));
    const timer = setTimeout(async () => {
      this.#listenReconnectTimer = null;
      if (this.closed || this.#listenChannels.size === 0) return;
      // Snapshot before any await so #closeListen() cannot clear the map under us.
      const channels = Array.from(this.#listenChannels.keys());
      let anyChannelFailed = false;
      try {
        const conn = await this.#ensureListenConnection();
        for (const channel of channels) {
          // Channel may have been unlistened while we awaited the connection.
          if (!this.#listenChannels.has(channel)) continue;
          try {
            await this.#runListenQuery(conn, `LISTEN ${this.#quoteChannel(channel)}`);
            const failures = this.#listenChannelFailures.get(channel);
            if (failures !== undefined) this.#listenChannelFailures.delete(channel);
            const onlistenPairs = this.#listenOnlistenCallbacks.get(channel);
            if (onlistenPairs) {
              for (const onlistens of onlistenPairs.values()) {
                for (const fn of onlistens) {
                  try {
                    fn.$call(undefined, this.#listenState);
                  } catch {}
                }
              }
            }
          } catch (err) {
            // Per-channel LISTEN failed on a live connection (transient PG error,
            // permissions blip, etc). Surface the error and track consecutive
            // failures — drop the channel after #listenMaxChannelFailures so we
            // don't retry forever for a permanently-misconfigured channel.
            const failures = (this.#listenChannelFailures.get(channel) ?? 0) + 1;
            this.#listenChannelFailures.set(channel, failures);
            const errMsg = (err as Error)?.message ?? String(err);
            if (failures >= this.#listenMaxChannelFailures) {
              console.warn(
                `bun:sql LISTEN to channel "${channel}" failed ${failures} times in a row; ` +
                  `giving up and removing the subscription. Last error: ${errMsg}`,
              );
              this.#listenChannels.delete(channel);
              this.#listenOnlistenCallbacks.delete(channel);
              this.#listenChannelFailures.delete(channel);
            } else {
              console.warn(
                `bun:sql LISTEN to channel "${channel}" failed (attempt ${failures}/${this.#listenMaxChannelFailures}): ${errMsg}`,
              );
              anyChannelFailed = true;
            }
          }
        }
        if (anyChannelFailed && this.#listenChannels.size > 0) {
          // Connection is alive but at least one channel did not register.
          // Schedule another tick; PG tolerates duplicate LISTENs as no-ops.
          this.#listenReconnectDelay = Math.min(this.#listenReconnectDelay * 2, 32000);
          this.#scheduleListenReconnect();
        } else {
          // All channels reconnected successfully — reset backoff for the next failure.
          this.#listenReconnectDelay = 250;
          // Dropping permanently-failing channels above may have drained the
          // set; release the connection in that case.
          this.#closeListenConnectionIfIdle();
        }
      } catch {
        this.#listenReconnectDelay = Math.min(this.#listenReconnectDelay * 2, 32000);
        this.#scheduleListenReconnect();
      }
    }, delayMs);
    // Deliberately NOT unref()'d: during the backoff window this timer is the
    // only thing keeping a subscribed-but-disconnected process alive, and it
    // can never outlive the subscriptions it serves (armed only while
    // channels are tracked; cleared by #closeListen and
    // #closeListenConnectionIfIdle when they drain).
    this.#listenReconnectTimer = timer;
  }

  // PG channel identifiers must be double-quoted to preserve case and allow
  // characters outside the unquoted-identifier grammar; embedded `"` doubles up.
  #quoteChannel(channel: string): string {
    return `"${channel.replaceAll('"', '""')}"`;
  }

  async #runListenQuery(conn: $ZigGeneratedClasses.PostgresSQLConnection, sql: string): Promise<void> {
    const pendingValue = new SQLResultArray();
    const handle = createPostgresQuery(sql, [], pendingValue, undefined, false, true);
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    // Fake query object — bypasses the user-facing Query class because LISTEN/UNLISTEN
    // don't fit the tagged-template path (no result rows, no Promise interface needed).
    //
    // CONTRACT (must stay in sync with src/js/internal/sql/postgres.ts initPostgres):
    //   onResolvePostgresQuery (this file, ~line 237):
    //     - is_last branch:    reads `query[_results]`, calls `query.resolve(...)`.
    //                          May call `queries.indexOf(query)`+`splice` IF the
    //                          connection has a JS-cached `queries` array — the
    //                          dedicated listen connection does not, so this branch
    //                          is skipped.
    //     - !is_last branch:   reads `query[_handle]`, calls `setPendingValue` on it,
    //                          mutates `query[_results]`. LISTEN/UNLISTEN produce a
    //                          single CommandComplete + ReadyForQuery so this is not
    //                          reached in practice — but we delegate setPendingValue
    //                          to the real native handle just in case.
    //   onRejectPostgresQuery (this file, ~line 300):
    //     - calls `query.reject(err)`. May call `queries.indexOf(query)` (same
    //       no-op as above for the listen connection).
    //
    // If either callback grows to access more fields (e.g. `query.cancel?.()`,
    // `query.done()`, etc.), those fields MUST be added here or LISTEN/UNLISTEN
    // will silently break. The native side never references this object directly —
    // it only flows through the two JS callbacks above.
    handle.run(conn, {
      resolve: () => resolve(),
      reject: (err: any) => reject(wrapPostgresError(err)),
      [_results]: null,
      [_handle]: {
        setPendingValue: (v: SQLResultArray) => handle.setPendingValue(v),
      },
    });
    return promise;
  }

  async listen(
    channel: string,
    onnotify: (payload: string) => void,
    onlisten?: (state: { pid: number; secret: number }) => void,
  ): Promise<{ state: { pid: number; secret: number }; unlisten: () => Promise<void> }> {
    if (typeof channel !== "string" || !channel)
      throw $ERR_INVALID_ARG_VALUE("channel", channel, "must be a non-empty string");
    if (channel.indexOf("\0") !== -1) throw $ERR_INVALID_ARG_VALUE("channel", channel, "must not contain null bytes");
    if (!$isCallable(onnotify)) throw $ERR_INVALID_ARG_TYPE("onnotify", "function", onnotify);
    if (onlisten !== undefined && !$isCallable(onlisten)) throw $ERR_INVALID_ARG_TYPE("onlisten", "function", onlisten);

    if (!this.#listenChannels.has(channel)) this.#listenChannels.set(channel, new Set());
    this.#listenChannels.get(channel)!.add(onnotify);

    if (onlisten) {
      if (!this.#listenOnlistenCallbacks.has(channel)) this.#listenOnlistenCallbacks.set(channel, new Map());
      const pairs = this.#listenOnlistenCallbacks.get(channel)!;
      if (!pairs.has(onnotify)) pairs.set(onnotify, new Set());
      pairs.get(onnotify)!.add(onlisten);
    }

    try {
      // Always issue LISTEN (idempotent server-side) and share the in-flight
      // promise so concurrent callers can't resolve before the ack and can't
      // miss the case where the connection dropped mid-handoff.
      let inFlight = this.#listenInFlight.get(channel);
      if (!inFlight) {
        inFlight = (async () => {
          const conn = await this.#ensureListenConnection();
          // Channel may have been unlistened while we awaited the connection;
          // don't subscribe the dedicated connection to a dead channel, and
          // don't leave the freshly-created connection behind if nothing is
          // subscribed anymore.
          if (!this.#listenChannels.has(channel)) {
            this.#closeListenConnectionIfIdle();
            return;
          }
          await this.#runListenQuery(conn, `LISTEN ${this.#quoteChannel(channel)}`);
        })().finally(() => {
          if (this.#listenInFlight.get(channel) === inFlight) this.#listenInFlight.delete(channel);
        });
        this.#listenInFlight.set(channel, inFlight);
      }
      await inFlight;
    } catch (err) {
      // Roll back only the registrations this call made — siblings keep theirs.
      const set = this.#listenChannels.get(channel);
      set?.delete(onnotify);
      if (onlisten) {
        const pairs = this.#listenOnlistenCallbacks.get(channel);
        const onlistens = pairs?.get(onnotify);
        onlistens?.delete(onlisten);
        if (onlistens && onlistens.size === 0) pairs!.delete(onnotify);
        if (pairs && pairs.size === 0) this.#listenOnlistenCallbacks.delete(channel);
      }
      if (set && set.size === 0) {
        this.#listenChannels.delete(channel);
        this.#listenOnlistenCallbacks.delete(channel);
      }
      // The LISTEN can fail on a live connection (server ErrorResponse); if
      // this rollback drained the last subscription, drop the now-idle
      // ref()'d connection or it would hold the event loop open forever.
      this.#closeListenConnectionIfIdle();
      throw err;
    }

    // Skip the initial onlisten if this subscription was unlistened while the
    // LISTEN ack was in flight — the registration is already gone.
    if (this.#listenChannels.get(channel)?.has(onnotify)) {
      try {
        onlisten?.(this.#listenState);
      } catch {}
    }

    // unlistened is checked then set synchronously inside the closure; no await
    // sits between the check and the assignment, so two simultaneous calls on a
    // single isolate cannot both pass the gate. If an `await` is ever introduced
    // before the flag flip, this becomes a TOCTOU bug — be careful.
    let unlistened = false;
    const unlisten = async () => {
      if (unlistened) return;
      unlistened = true;
      // unlisten(channel, onnotify) also drops the onlisten callbacks paired
      // with this onnotify, so no separate cleanup is needed here.
      await this.unlisten(channel, onnotify);
    };
    return {
      state: this.#listenState,
      unlisten,
      // `await using sub = await sql.listen(...)` removes the subscription on
      // scope exit.
      [Symbol.asyncDispose]: unlisten,
    };
  }

  async unlisten(channel: string, onnotify?: (payload: string) => void): Promise<void> {
    if (typeof channel !== "string" || !channel)
      throw $ERR_INVALID_ARG_VALUE("channel", channel, "must be a non-empty string");
    if (channel.indexOf("\0") !== -1) throw $ERR_INVALID_ARG_VALUE("channel", channel, "must not contain null bytes");
    if (onnotify !== undefined && !$isCallable(onnotify)) throw $ERR_INVALID_ARG_TYPE("onnotify", "function", onnotify);

    if (!onnotify) {
      this.#listenChannels.delete(channel);
      this.#listenOnlistenCallbacks.delete(channel);
      this.#listenChannelFailures.delete(channel);
    } else {
      this.#listenChannels.get(channel)?.delete(onnotify);
      // Drop the onlisten callbacks paired with this onnotify so they stop
      // firing on reconnect once their subscription is gone.
      const pairs = this.#listenOnlistenCallbacks.get(channel);
      pairs?.delete(onnotify);
      if (pairs && pairs.size === 0) this.#listenOnlistenCallbacks.delete(channel);
      if (this.#listenChannels.get(channel)?.size === 0) {
        this.#listenChannels.delete(channel);
        this.#listenOnlistenCallbacks.delete(channel);
        this.#listenChannelFailures.delete(channel);
      }
    }

    if (this.#listenChannels.size === 0) {
      // Closing the connection implicitly drops every server-side LISTEN
      // registration, so no UNLISTEN round-trip is needed.
      this.#closeListenConnectionIfIdle();
    } else if (this.#listenConnection && !this.#listenChannels.has(channel)) {
      await this.#runListenQuery(this.#listenConnection, `UNLISTEN ${this.#quoteChannel(channel)}`);
    }
  }

  // After the last subscription is removed there is nothing left to receive:
  // drop the dedicated connection (and any pending reconnect) rather than
  // keeping an idle ref()'d backend session that would hold the event loop
  // open. The next listen() recreates it.
  #closeListenConnectionIfIdle() {
    if (this.#listenChannels.size > 0) return;
    if (this.#listenReconnectTimer) {
      clearTimeout(this.#listenReconnectTimer);
      this.#listenReconnectTimer = null;
    }
    const conn = this.#listenConnection;
    this.#listenConnection = null;
    if (conn) {
      try {
        conn.close();
      } catch {}
    }
  }
}

export default {
  PostgresAdapter,
};
