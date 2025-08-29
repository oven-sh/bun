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
    "mysqls",
    "file",
    "sqlite",
    "unix",
  ];
  for (const protocol of protocols) {
    if (url.startsWith(protocol + "://")) {
      return true;
    }
  }
  return false;
}

function getAdapterFromProtocol(protocol: string): Bun.SQL.__internal.Adapter | null {
  switch (protocol) {
    case "postgres":
    case "postgresql":
      return "postgres";
    case "mysql":
    case "mysql2":
    case "mariadb":
    case "mysqls":
      return "mysql";
    case "file":
    case "sqlite":
      return "sqlite";
    case "unix":
      return null; // Unix sockets require explicit adapter
    default:
      return null;
  }
}

function determineAdapter(
  options: Bun.SQL.Options,
  urlString: string | URL | null,
  env?: Record<string, string | undefined>,
): Bun.SQL.__internal.Adapter {
  // 1. Use explicit adapter if provided
  if (options.adapter) {
    const adapter = options.adapter;
    switch (adapter) {
      case "postgres":
      case "postgresql":
        return "postgres";
      case "mysql":
      case "mysql2":
      case "mariadb":
        return "mysql";
      case "sqlite":
        return "sqlite";
      default:
        throw new Error(`Unsupported adapter: ${adapter}. Supported adapters: "postgres", "sqlite", "mysql"`);
    }
  }

  // 2. Infer from URL protocol if present
  if (urlString) {
    const urlStr = urlString instanceof URL ? urlString.href : urlString;

    // Check for SQLite URLs first
    if (parseDefinitelySqliteUrl(urlStr) !== null) {
      return "sqlite";
    }

    // Extract protocol
    const colonIndex = urlStr.indexOf(":");
    if (colonIndex !== -1) {
      const protocol = urlStr.substring(0, colonIndex);
      const adapterFromProtocol = getAdapterFromProtocol(protocol);
      if (adapterFromProtocol) {
        return adapterFromProtocol;
      }
    }
  }

  // 3. If no URL provided, check environment variables to infer adapter
  // Respect precedence: POSTGRES_URL > DATABASE_URL > PGURL > PG_URL > MYSQL_URL
  if (!urlString && env) {
    // Check in order of precedence (including TLS variants)
    const envVars = [
      { name: "POSTGRES_URL", url: env.POSTGRES_URL },
      { name: "TLS_POSTGRES_DATABASE_URL", url: env.TLS_POSTGRES_DATABASE_URL },
      { name: "DATABASE_URL", url: env.DATABASE_URL },
      { name: "TLS_DATABASE_URL", url: env.TLS_DATABASE_URL },
      { name: "PGURL", url: env.PGURL },
      { name: "PG_URL", url: env.PG_URL },
      { name: "MYSQL_URL", url: env.MYSQL_URL },
      { name: "TLS_MYSQL_DATABASE_URL", url: env.TLS_MYSQL_DATABASE_URL }
    ];

    for (const { name, url: envUrl } of envVars) {
      if (envUrl) {
        // Check for SQLite URLs first (special case)
        if (parseDefinitelySqliteUrl(envUrl) !== null) {
          return "sqlite";
        }

        // Environment variable name takes precedence over protocol
        if (name === "MYSQL_URL" || name === "TLS_MYSQL_DATABASE_URL") {
          return "mysql";
        } else if (name === "POSTGRES_URL" || name === "TLS_POSTGRES_DATABASE_URL" || name === "PGURL" || name === "PG_URL") {
          return "postgres";
        }
        
        // For generic DATABASE_URL and TLS_DATABASE_URL, use protocol detection as fallback
        if (name === "DATABASE_URL" || name === "TLS_DATABASE_URL") {
          const colonIndex = envUrl.indexOf(":");
          if (colonIndex !== -1) {
            const protocol = envUrl.substring(0, colonIndex);
            const adapterFromProtocol = getAdapterFromProtocol(protocol);
            if (adapterFromProtocol) {
              return adapterFromProtocol;
            }
          }
        }

        // If we found a URL with higher precedence, don't check lower precedence URLs
        break;
      }
    }
  }

  // 4. Default to postgres if no explicit adapter or protocol
  return "postgres";
}

function getEnvironmentUrlsForAdapter(adapter: Bun.SQL.__internal.Adapter, env: Record<string, string | undefined>) {
  const urls: (string | undefined)[] = [];

  if (adapter === "postgres") {
    urls.push(env.POSTGRES_URL, env.DATABASE_URL, env.PGURL, env.PG_URL);
    // Also check TLS variants
    urls.push(env.TLS_POSTGRES_DATABASE_URL, env.TLS_DATABASE_URL);
  } else if (adapter === "mysql") {
    urls.push(env.MYSQL_URL, env.DATABASE_URL);
    // Also check TLS variants
    urls.push(env.TLS_MYSQL_DATABASE_URL, env.TLS_DATABASE_URL);
  } else if (adapter === "sqlite") {
    urls.push(env.DATABASE_URL);
  }

  return urls.filter((url): url is string => typeof url === "string" && url.length > 0);
}

function getAdapterSpecificDefaults(adapter: Bun.SQL.__internal.Adapter, env: Record<string, string | undefined>) {
  const defaults: {
    hostname?: string;
    port?: number;
    username?: string;
    password?: string;
    database?: string;
  } = {};

  if (adapter === "postgres") {
    defaults.hostname = env.PGHOST;
    defaults.port = env.PGPORT ? Number(env.PGPORT) : undefined;
    defaults.username = env.PGUSERNAME || env.PGUSER || env.USER || env.USERNAME;
    defaults.password = env.PGPASSWORD;
    defaults.database = env.PGDATABASE;
  } else if (adapter === "mysql") {
    defaults.hostname = env.MYSQL_HOST;
    defaults.port = env.MYSQL_PORT ? Number(env.MYSQL_PORT) : undefined;
    defaults.username = env.MYSQL_USER || env.USER || env.USERNAME;
    defaults.password = env.MYSQL_PASSWORD;
    defaults.database = env.MYSQL_DATABASE;
  } else if (adapter === "sqlite") {
    // SQLite doesn't use these connection parameters
  }

  return defaults;
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

  // Step 1: Determine input string/URL and options
  let inputUrl: string | URL | null = null;
  let options: Bun.SQL.Options;

  if (typeof stringOrUrlOrOptions === "string" || stringOrUrlOrOptions instanceof URL) {
    inputUrl = stringOrUrlOrOptions;
    options = definitelyOptionsButMaybeEmpty;
  } else if (stringOrUrlOrOptions) {
    options = { ...stringOrUrlOrOptions, ...definitelyOptionsButMaybeEmpty };
    inputUrl = options.url || null;
  } else {
    options = definitelyOptionsButMaybeEmpty;
  }

  // Step 2: Determine the adapter (without reading environment variables yet)
  const adapter = determineAdapter(options, inputUrl, env);

  // Handle SQLite early since it has different logic
  if (adapter === "sqlite") {
    return handleSQLiteOptions(options, inputUrl, env);
  }

  // Step 3: Get the appropriate URL for this adapter
  let finalUrl: URL | null = null;
  let sslMode: SSLMode = SSLMode.disable;

  if (inputUrl) {
    // User provided a URL directly
    finalUrl = inputUrl instanceof URL ? inputUrl : parseUrlForAdapter(inputUrl, adapter);
  } else {
    // Look for environment URLs appropriate for this adapter
    // Only use environment URLs if no explicit connection options are provided
    const hasExplicitConnectionOptions = !!(
      options.hostname ||
      options.host ||
      options.port ||
      options.username ||
      options.user ||
      options.password ||
      options.pass ||
      options.database ||
      options.db
    );

    if (!hasExplicitConnectionOptions) {
      const envUrls = getEnvironmentUrlsForAdapter(adapter, env);
      const envUrl = envUrls[0]; // Get first available URL

      if (envUrl) {
        // Check if it's a TLS URL that sets SSL mode
        if (envUrl === env.TLS_POSTGRES_DATABASE_URL || envUrl === env.TLS_DATABASE_URL || envUrl === env.TLS_MYSQL_DATABASE_URL) {
          sslMode = SSLMode.require;
        }
        finalUrl = parseUrlForAdapter(envUrl, adapter);
      }
    }
  }

  // Step 4: Validate adapter matches protocol if URL is provided
  if (finalUrl && inputUrl) {
    validateAdapterProtocolMatch(adapter, finalUrl);
  }

  // Step 5: Normalize and validate options for the specific adapter
  return normalizeOptionsForAdapter(adapter, options, finalUrl, env, sslMode);
}

function handleSQLiteOptions(
  options: Bun.SQL.Options,
  inputUrl: string | URL | null,
  env: Record<string, string | undefined>,
): Bun.SQL.__internal.DefinedSQLiteOptions {
  let filename: string | URL | null = options.filename || inputUrl;

  // If no filename provided, check environment
  if (!filename) {
    const envUrl = env.DATABASE_URL;
    if (envUrl) {
      const parsed = parseDefinitelySqliteUrl(envUrl);
      if (parsed !== null) {
        filename = parsed;
      }
    }
  }

  // Parse SQLite URLs
  if (typeof filename === "string" || filename instanceof URL) {
    const parsed = parseDefinitelySqliteUrl(filename);
    if (parsed !== null) {
      filename = parsed;
    }
  }

  // Special handling for empty strings: should default to :memory:
  let finalFilename: string;
  if (filename === null || filename === undefined) {
    finalFilename = ":memory:";
  } else if (filename === "") {
    // Empty string when explicitly passed (like new SQL("", {adapter: "sqlite"})) should be :memory:
    finalFilename = inputUrl === "" ? ":memory:" : "";
  } else {
    finalFilename = filename as string;
  }

  const sqliteOptions: Bun.SQL.__internal.DefinedSQLiteOptions = {
    ...options,
    adapter: "sqlite",
    filename: finalFilename,
  };

  return parseSQLiteOptionsWithQueryParams(sqliteOptions, inputUrl);
}

function parseUrlForAdapter(urlString: string, adapter: Bun.SQL.__internal.Adapter): URL {
  if (urlString.startsWith("unix://")) {
    // Handle unix:// URLs specially
    return new URL(urlString);
  }

  // Check if it's a SQLite URL that can't be parsed as a standard URL
  if (parseDefinitelySqliteUrl(urlString) !== null) {
    // Create a fake URL for SQLite that won't fail URL parsing
    return new URL("sqlite:///" + encodeURIComponent(urlString));
  }

  if (hasProtocol(urlString)) {
    return new URL(urlString);
  }

  // Add default protocol for the adapter
  const defaultProtocol = adapter === "mysql" ? "mysql://" : "postgres://";
  return new URL(defaultProtocol + urlString);
}

function validateAdapterProtocolMatch(adapter: Bun.SQL.__internal.Adapter, url: URL) {
  const protocol = url.protocol.replace(":", "");

  if (protocol === "unix") {
    // Unix sockets are valid for any adapter
    return;
  }

  const expectedAdapter = getAdapterFromProtocol(protocol);
  if (expectedAdapter && expectedAdapter !== adapter) {
    throw new Error(
      `Protocol '${protocol}' is not compatible with adapter '${adapter}'. Expected adapter '${expectedAdapter}'.`,
    );
  }
}

function normalizeOptionsForAdapter(
  adapter: Bun.SQL.__internal.Adapter,
  options: Bun.SQL.Options,
  url: URL | null,
  env: Record<string, string | undefined>,
  sslMode: SSLMode,
): Bun.SQL.__internal.DefinedOptions {
  // Get adapter-specific defaults from environment
  const envDefaults = getAdapterSpecificDefaults(adapter, env);

  let hostname: string | undefined,
    port: number | string | undefined,
    username: string | null | undefined,
    password: string | (() => Bun.MaybePromise<string>) | undefined | null,
    database: string | undefined,
    tls: Bun.TLSOptions | boolean | undefined,
    query = "",
    idleTimeout: number | null | undefined,
    connectionTimeout: number | null | undefined,
    maxLifetime: number | null | undefined,
    onconnect: ((client: Bun.SQL) => void) | undefined,
    onclose: ((client: Bun.SQL) => void) | undefined,
    max: number | null | undefined,
    bigint: boolean | undefined,
    path = "";

  let prepare = true;

  // Parse URL if provided
  if (url) {
    if (url.protocol === "unix:") {
      // Handle unix domain socket
      path = url.pathname;
    } else {
      hostname = url.hostname;
      port = url.port;
      username = decodeIfValid(url.username);
      password = decodeIfValid(url.password);
      database = decodeIfValid(url.pathname.slice(1)); // Remove leading /

      const queryObject = url.searchParams.toJSON();
      for (const key in queryObject) {
        if (key.toLowerCase() === "sslmode") {
          sslMode = normalizeSSLMode(queryObject[key]);
        } else if (key.toLowerCase() === "path") {
          path = queryObject[key];
        } else {
          query += `${key}\0${queryObject[key]}\0`;
        }
      }
      query = query.trim();
    }
  }

  // Apply explicit options (highest precedence)
  hostname ||= options.hostname || options.host;
  port ||= options.port;
  username ||= options.username || options.user;
  password ||= options.password || options.pass;
  database ||= options.database || options.db;
  path ||= (options as { path?: string }).path;

  // Apply adapter-specific environment defaults (medium precedence)
  hostname ||= envDefaults.hostname;
  port ||= envDefaults.port;
  username ||= envDefaults.username;
  password ||= envDefaults.password;
  database ||= envDefaults.database;

  // Apply final defaults (lowest precedence)
  hostname ||= "localhost";
  port ||= Number(port) || (adapter === "mysql" ? 3306 : 5432);
  username ||= adapter === "mysql" ? "root" : "postgres";
  database ||= adapter === "mysql" ? "mysql" : username;
  password ||= "";

  // Handle PostgreSQL unix domain socket special case
  if (adapter === "postgres" && path && Number.isSafeInteger(port) && path.indexOf("/.s.PGSQL.") === -1) {
    const pathWithSocket = `${path}/.s.PGSQL.${port}`;
    if (require("node:fs").existsSync(pathWithSocket)) {
      path = pathWithSocket;
    }
  }

  // Handle connection parameters
  const connection = options.connection;
  if (connection && $isObject(connection)) {
    for (const key in connection) {
      if (connection[key] !== undefined) {
        query += `${key}\0${connection[key]}\0`;
      }
    }
  }

  // Handle TLS
  tls ||= options.tls || options.ssl;
  if (options?.tls) {
    sslMode = SSLMode.require;
    tls = options.tls;
  }

  // Handle other options
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

  // Handle prepare option
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

  // Validate numeric options
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

  // Handle TLS configuration
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
    // For unix sockets or when explicitly set, always use the path
    // Don't require existence check for unix sockets since they might not exist yet
    if (url?.protocol === "unix:" || (options as { path?: string }).path) {
      ret.path = path;
    } else if (require("node:fs").existsSync(path)) {
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
