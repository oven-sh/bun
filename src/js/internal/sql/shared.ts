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
  sqliteOptions: Bun.SQL.__internal.DefinedSQLiteOptions,
  urlString: string | URL | null | undefined,
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
function parseOptions(
  stringOrUrlOrOptions: Bun.SQL.Options | string | URL | undefined,
  definitelyOptionsButMaybeEmpty: Bun.SQL.Options,
): Bun.SQL.__internal.DefinedOptions {
  const env = Bun.env;

  let [
    stringOrUrl = env.POSTGRES_URL || env.DATABASE_URL || env.PGURL || env.PG_URL || env.MYSQL_URL || null,
    options,
  ]: [string | URL | null, Bun.SQL.Options] =
    typeof stringOrUrlOrOptions === "string" || stringOrUrlOrOptions instanceof URL
      ? [stringOrUrlOrOptions, definitelyOptionsButMaybeEmpty]
      : stringOrUrlOrOptions
        ? [null, { ...stringOrUrlOrOptions, ...definitelyOptionsButMaybeEmpty }]
        : [null, definitelyOptionsButMaybeEmpty];

  if (options.adapter === undefined && stringOrUrl !== null) {
    const sqliteUrl = parseDefinitelySqliteUrl(stringOrUrl);

    if (sqliteUrl !== null) {
      const sqliteOptions: Bun.SQL.__internal.DefinedSQLiteOptions = {
        ...options,
        adapter: "sqlite",
        filename: sqliteUrl,
      };

      return parseSQLiteOptionsWithQueryParams(sqliteOptions, stringOrUrl);
    }
  }

  if (options.adapter === "sqlite") {
    let filenameFromOptions = options.filename || stringOrUrl;

    // Parse sqlite:// URLs when adapter is explicitly sqlite
    if (typeof filenameFromOptions === "string" || filenameFromOptions instanceof URL) {
      const parsed = parseDefinitelySqliteUrl(filenameFromOptions);
      if (parsed !== null) {
        filenameFromOptions = parsed;
      }
    }

    const sqliteOptions: Bun.SQL.__internal.DefinedSQLiteOptions = {
      ...options,
      adapter: "sqlite",
      filename: filenameFromOptions || ":memory:",
    };

    return parseSQLiteOptionsWithQueryParams(sqliteOptions, stringOrUrl);
  }

  if (!stringOrUrl) {
    const url = options?.url;
    if (typeof url === "string") {
      stringOrUrl = defaultToPostgresIfNoProtocol(url);
    } else if (url instanceof URL) {
      stringOrUrl = url;
    }
  }

  let hostname: string | undefined,
    port: number | string | undefined,
    username: string | null | undefined,
    password: string | (() => Bun.MaybePromise<string>) | undefined | null,
    database: string | undefined,
    tls: Bun.TLSOptions | boolean | undefined,
    url: URL | undefined,
    query: string,
    idleTimeout: number | null | undefined,
    connectionTimeout: number | null | undefined,
    maxLifetime: number | null | undefined,
    onconnect: ((client: Bun.SQL) => void) | undefined,
    onclose: ((client: Bun.SQL) => void) | undefined,
    max: number | null | undefined,
    bigint: boolean | undefined,
    path: string,
    adapter: Bun.SQL.__internal.Adapter;

  let prepare = true;
  let sslMode: SSLMode = SSLMode.disable;

  if (!stringOrUrl || (typeof stringOrUrl === "string" && stringOrUrl.length === 0)) {
    let urlString = env.POSTGRES_URL || env.DATABASE_URL || env.PGURL || env.PG_URL;

    if (!urlString) {
      urlString = env.TLS_POSTGRES_DATABASE_URL || env.TLS_DATABASE_URL;
      if (urlString) {
        sslMode = SSLMode.require;
      }
    }

    if (urlString) {
      // Check if it's a SQLite URL before trying to parse as regular URL
      const sqliteUrl = parseDefinitelySqliteUrl(urlString);
      if (sqliteUrl !== null) {
        const sqliteOptions: Bun.SQL.__internal.DefinedSQLiteOptions = {
          ...options,
          adapter: "sqlite",
          filename: sqliteUrl,
        };
        return parseSQLiteOptionsWithQueryParams(sqliteOptions, urlString);
      }

      url = new URL(urlString);
    }
  } else if (stringOrUrl && typeof stringOrUrl === "object") {
    if (stringOrUrl instanceof URL) {
      url = stringOrUrl;
    } else if (options?.url) {
      const _url = options.url;
      if (typeof _url === "string") {
        url = defaultToPostgresIfNoProtocol(_url);
      } else if (_url && typeof _url === "object" && _url instanceof URL) {
        url = _url;
      }
    }
    if (options?.tls) {
      sslMode = SSLMode.require;
      tls = options.tls;
    }
  } else if (typeof stringOrUrl === "string") {
    try {
      url = defaultToPostgresIfNoProtocol(stringOrUrl);
    } catch (e) {
      throw new Error(`Invalid URL '${stringOrUrl}' for postgres. Did you mean to specify \`{ adapter: "sqlite" }\`?`, {
        cause: e,
      });
    }
  }
  query = "";
  adapter = options.adapter;
  if (url) {
    ({ hostname, port, username, password, adapter } = options);
    // object overrides url
    hostname ||= url.hostname;
    port ||= url.port;
    username ||= decodeIfValid(url.username);
    password ||= decodeIfValid(url.password);
    adapter ||= url.protocol as Bun.SQL.__internal.Adapter;
    if (adapter && adapter[adapter.length - 1] === ":") {
      adapter = adapter.slice(0, -1) as Bun.SQL.__internal.Adapter;
    }

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
  if (adapter) {
    switch (adapter) {
      case "http":
      case "https":
      case "ftp":
      case "postgres":
      case "postgresql":
        adapter = "postgres";
        break;
      case "mysql":
      case "mysql2":
      case "mariadb":
        adapter = "mysql";
        break;
      case "file":
      case "sqlite":
        adapter = "sqlite";
        break;
      default:
        options.adapter satisfies never; // This will type error if we support a new adapter in the future, which will let us know to update this check
        throw new Error(`Unsupported adapter: ${options.adapter}. Supported adapters: "postgres", "sqlite", "mysql"`);
    }
  } else {
    adapter = "postgres";
  }
  options.adapter = adapter;
  assertIsOptionsOfAdapter(options, adapter);
  hostname ||= options.hostname || options.host || env.PGHOST || "localhost";

  port ||= Number(options.port || env.PGPORT || (adapter === "mysql" ? 3306 : 5432));

  path ||= (options as { path?: string }).path || "";

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
    (adapter === "mysql" ? "mysql" : username); // default database;
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

  if (sslMode !== SSLMode.disable && !tls?.serverName) {
    if (hostname) {
      tls = { ...tls, serverName: hostname };
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
