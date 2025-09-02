const PublicArray = globalThis.Array;

declare global {
  interface NumberConstructor {
    isSafeInteger(number: unknown): number is number;
    isNaN(number: number): boolean;
  }
}

export type { SQLResultArray };
class SQLResultArray<T> extends PublicArray<T> {
  public count!: number | null;
  public command!: string | null;
  public lastInsertRowid!: number | bigint | null;

  static [Symbol.toStringTag] = "SQLResults";

  constructor(values: T[] = []) {
    super(...values);

    // match postgres's result array, in this way for in will not list the
    // properties and .map will not return undefined command and count
    Object.defineProperties(this, {
      count: { value: null, writable: true },
      command: { value: null, writable: true },
      lastInsertRowid: { value: null, writable: true },
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

  throw $ERR_INVALID_ARG_VALUE("sslmode", value);
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

function parseDefinitelySqliteUrl(value: string | URL | null): string | null {
  if (value === null) return null;
  const str = value instanceof URL ? value.toString() : value;

  if (str === ":memory:" || str === "sqlite://:memory:" || str === "sqlite:memory") return ":memory:";

  // For any URL-like string, just extract the path portion
  // Strip the protocol and handle query params
  let path: string;

  if (str.startsWith("sqlite://")) {
    path = str.slice(9); // "sqlite://".length
  } else if (str.startsWith("sqlite:")) {
    path = str.slice(7); // "sqlite:".length
  } else if (str.startsWith("file://")) {
    // For file:// URLs, use Bun's built-in converter for correct platform handling
    // This properly handles Windows paths, UNC paths, etc.
    try {
      return Bun.fileURLToPath(str);
    } catch {
      // Fallback: just strip the protocol
      path = str.slice(7); // "file://".length
    }
  } else if (str.startsWith("file:")) {
    path = str.slice(5); // "file:".length
  } else {
    // Not a SQLite URL
    return null;
  }

  // Remove query parameters if present (only looking for ?)
  const queryIndex = path.indexOf("?");
  if (queryIndex !== -1) {
    path = path.slice(0, queryIndex);
  }

  return path;
}

function parseSQLiteOptionsWithQueryParams(
  urlString: string | URL | null | undefined,
  sqliteOptions: Bun.SQL.__internal.DefinedSQLiteOptions,
): Bun.SQL.__internal.DefinedSQLiteOptions {
  if (!urlString) return sqliteOptions;

  let params: URLSearchParams | null = null;

  if (urlString instanceof URL) {
    params = urlString.searchParams;
  } else {
    const queryIndex = urlString.indexOf("?");
    if (queryIndex === -1) return sqliteOptions;

    const queryString = urlString.slice(queryIndex + 1);
    params = new URLSearchParams(queryString);
  }

  const mode = params.get("mode");

  if (mode === "ro") {
    sqliteOptions.readonly = true;
  } else if (mode === "rw") {
    sqliteOptions.readonly = false;
  } else if (mode === "rwc") {
    sqliteOptions.readonly = false;
    sqliteOptions.create = true;
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

function hasProtocol(url: string) {
  if (typeof url !== "string") return false;
  const protocols: string[] = [
    "http",
    "https",
    "ftp",
    "postgres",
    "postgresql",
    "mysql",
    "mysql2",
    "mariadb",
    "file",
    "sqlite",
  ];
  for (const protocol of protocols) {
    if (url.startsWith(protocol + "://")) {
      return true;
    }
  }
  return false;
}

function defaultToPostgresIfNoProtocol(url: string | URL | null): URL {
  if (url instanceof URL) {
    return url;
  }
  if (hasProtocol(url as string)) {
    return new URL(url as string);
  }
  return new URL("postgres://" + url);
}

const DEFAULT_PROTOCOL: Bun.SQL.__internal.Adapter = "postgres";

const env = Bun.env;

function getConnectionDetailsFromEnvironment(
  adapter: Bun.SQL.__internal.Adapter | undefined,
): [url: string | null, sslMode: SSLMode | null] {
  let url: string | null = null;
  let sslMode: SSLMode | null = null;

  if (adapter === undefined) {
    url =
      env.POSTGRES_URL ||
      env.DATABASE_URL ||
      env.PGURL ||
      env.PG_URL ||
      env.PGURL ||
      env.MYSQL_URL ||
      env.SQLITE_URL ||
      null; // fallback default values are handled in the parseOptions function, since the values are not coming from the env itself

    if (!url) {
      url = env.TLS_POSTGRES_DATABASE_URL || env.TLS_DATABASE_URL || null;
      if (url) sslMode = SSLMode.require;
    }

    return [url, sslMode];
  }

  switch (adapter) {
    case "postgres":
      url = env.POSTGRES_URL || env.DATABASE_URL || env.PG_URL || env.PGURL || env.PG_URL || null;
      if (!url) {
        url = env.TLS_POSTGRES_DATABASE_URL || env.TLS_DATABASE_URL || null;
        if (url) sslMode = SSLMode.require;
      }
      return [url, sslMode];

    case "mysql":
      url = env.MYSQL_URL || env.DATABASE_URL || null;
      if (!url) {
        url = env.TLS_MYSQL_DATABASE_URL || env.TLS_DATABASE_URL || null;
        if (url) sslMode = SSLMode.require;
      }
      return [url, sslMode];

    case "sqlite":
      return [env.SQLITE_URL || env.DATABASE_URL || null, null];
  }

  return [null, null];
}

/**
 * @returns A tuple containing the parsed adapter (this is always correct) and a
 * url string, that you should continue to use for further options. In some
 * cases the it will be a parsed URL instance, and in others a string. This is
 * to save unnecessary parses in some caes. The third value is the SSL mode The last value is the options object
 * resolved from the possible overloads of the Bun.SQL constructor, it may have modifications
 */
function parseConnectionDetailsFromOptionsOrEnvironment(
  stringOrUrlOrOptions: Bun.SQL.Options | string | URL | undefined,
  definitelyOptionsButMaybeEmpty: Bun.SQL.Options,
): [url: string | URL | null, sslMode: SSLMode | null, options: Bun.SQL.__internal.Define<Bun.SQL.Options, "adapter">] {
  const [urlFromEnvironment, sslMode] = getConnectionDetailsFromEnvironment(definitelyOptionsButMaybeEmpty.adapter);

  let stringOrUrl: string | URL | null;
  let options: Bun.SQL.Options;

  if (typeof stringOrUrlOrOptions === "string" || stringOrUrlOrOptions instanceof URL) {
    stringOrUrl = stringOrUrlOrOptions;
    options = definitelyOptionsButMaybeEmpty;
  } else if (stringOrUrlOrOptions) {
    stringOrUrl = null;
    options = { ...stringOrUrlOrOptions, ...definitelyOptionsButMaybeEmpty };
  } else {
    stringOrUrl = urlFromEnvironment;
    options = definitelyOptionsButMaybeEmpty;
  }

  // Always use .url if specified in options since we consider options as the
  // ultimate source of truth
  if ("url" in options && options.url) {
    stringOrUrl = options.url;
  }

  let url: string | URL | null = stringOrUrl;

  // If adapter was specified in options, we should ALWAYS use it over anything
  // parsed from the connection string (options object is considered the
  // ultimate source of truth for values)
  if (options.adapter !== undefined) {
    return [url, sslMode, { ...options, adapter: options.adapter }] as const;
  }

  let protocol: Bun.SQL.__internal.Adapter | (string & {}) = DEFAULT_PROTOCOL;

  if (stringOrUrl instanceof URL) {
    protocol = stringOrUrl.protocol;
  } else {
    const definitelySqliteUrl = parseDefinitelySqliteUrl(stringOrUrl);

    if (definitelySqliteUrl) {
      protocol = "sqlite";
      url = definitelySqliteUrl;
    }

    if (stringOrUrl !== null) {
      try {
        url = new URL(stringOrUrl);
        protocol = url.protocol;
      } catch {}
    }
  }

  switch (protocol) {
    case "http":
    case "https":
    case "ftp":
    case "postgres":
    case "postgresql":
      return [url, sslMode, { ...options, adapter: "postgres" }];

    case "mysql":
    case "mysql2":
    case "mariadb":
      return [url, sslMode, { ...options, adapter: "mysql" }];

    case "file":
    case "sqlite":
      return [url, sslMode, { ...options, adapter: "sqlite" }];

    default:
      throw new Error(`Unsupported protocol: ${protocol}. Supported adapters: "postgres", "sqlite", "mysql"`);
  }
}

function parseOptions(
  stringOrUrlOrOptions: Bun.SQL.Options | string | URL | undefined,
  definitelyOptionsButMaybeEmpty: Bun.SQL.Options,
): Bun.SQL.__internal.DefinedOptions {
  const [urlFromConnectionDetails, sslModeFromConnectionDetails, options] =
    parseConnectionDetailsFromOptionsOrEnvironment(stringOrUrlOrOptions, definitelyOptionsButMaybeEmpty);

  if (options.adapter === "sqlite") {
    return parseSQLiteOptionsWithQueryParams(urlFromConnectionDetails, {
      ...options,
      adapter: "sqlite",
      filename: urlFromConnectionDetails ?? ":memory:",
    });
  }

  let sslMode: SSLMode = sslModeFromConnectionDetails || SSLMode.prefer;

  const url = urlFromConnectionDetails
    ? urlFromConnectionDetails instanceof URL
      ? urlFromConnectionDetails
      : new URL(urlFromConnectionDetails)
    : null;

  let hostname: string | undefined,
    port: number | string | undefined,
    username: string | null | undefined,
    password: string | (() => Bun.MaybePromise<string>) | undefined | null,
    database: string | undefined,
    tls: Bun.TLSOptions | boolean | undefined,
    query: string = "",
    idleTimeout: number | null | undefined,
    connectionTimeout: number | null | undefined,
    maxLifetime: number | null | undefined,
    onconnect: ((client: Bun.SQL) => void) | undefined,
    onclose: ((client: Bun.SQL) => void) | undefined,
    max: number | null | undefined,
    bigint: boolean | undefined,
    path: string,
    prepare: boolean = true;

  if (url) {
    ({ hostname, port, username, password } = options);
    // options object overrides url
    hostname ||= url.hostname;
    port ||= url.port;
    username ||= decodeIfValid(url.username);
    password ||= decodeIfValid(url.password);

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
        query += `${key}\0${queryObject[key]}\0`;
      }
    }
    query = query.trim();
  }

  const adapter = options.adapter;

  switch (adapter) {
    case "postgres": {
      hostname ||= options.hostname || options.host || env.PGHOST || "localhost";
      break;
    }
    case "mysql": {
      hostname ||= options.hostname || options.host || env.MYSQLHOST || "localhost";
      break;
    }
    case "mariadb": {
      hostname ||= options.hostname || options.host || env.MARIADBHOST || "localhost";
      break;
    }
    default: {
      throw new Error(`Unsupported adapter: ${adapter}`);
    }
  }

  switch (adapter) {
    case "postgres": {
      port ||= Number(options.port || env.PGPORT || "5432");
      break;
    }
    case "mysql": {
      port ||= Number(options.port || env.MYSQLPORT || "3306");
      break;
    }
    case "mariadb": {
      port ||= Number(options.port || env.MARIADBPORT || "3306");
      break;
    }
    default: {
      throw new Error(`Unsupported adapter: ${adapter}`);
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

  username ||=
    options.username ||
    options.user ||
    env.PGUSERNAME ||
    env.PGUSER ||
    env.USER ||
    env.USERNAME ||
    (adapter === "mysql" ? "root" : "postgres"); // default username for mysql is root and for postgres is postgres;

  database ||=
    options.database ||
    options.db ||
    decodeIfValid((url?.pathname ?? "").slice(1)) ||
    env.PGDATABASE ||
    (adapter === "postgres" ? username : "mysql"); // default database to the username under postgres, or mysql under mysql or mariadb

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

  if (sslMode !== SSLMode.disable && ((typeof tls === "object" && !tls.serverName) || typeof tls === "boolean")) {
    if (hostname) {
      if (typeof tls === "object") {
        tls = { ...tls, serverName: hostname };
      } else {
        tls = { serverName: hostname };
      }
    } else if (tls) {
      tls = true;
    }
  }

  if (tls && sslMode === SSLMode.disable) {
    sslMode = SSLMode.prefer;
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
  release(connection: ConnectionHandle, connectingEvent?: boolean): void;
  close(options?: { timeout?: number }): Promise<void>;
  flush(): void;

  isConnected(): boolean;
  get closed(): boolean;

  supportsReservedConnections?(): boolean;
  getConnectionForQuery?(pooledConnection: Connection): ConnectionHandle | null;
  attachConnectionCloseHandler?(connection: Connection, handler: () => void): void;
  detachConnectionCloseHandler?(connection: Connection, handler: () => void): void;

  getTransactionCommands(options?: string): TransactionCommands;
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
  SSLMode,
  normalizeSSLMode,
  SQLResultArray,
};
