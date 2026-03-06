const PublicArray = globalThis.Array;

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

  if (options.adapter === "sqlite") {
    // SQLite adapter - only check filename (not url)
    if ("filename" in options && options.filename) {
      resolvedUrl = options.filename;
    }
  } else if (!options.adapter) {
    // Unknown adapter - check both, filename first (more specific)
    if ("filename" in options && options.filename) {
      resolvedUrl = options.filename;
    } else if ("url" in options && options.url) {
      resolvedUrl = options.url;
    }
  } else {
    // Known non-SQLite adapter - only check url (not filename)
    if ("url" in options && options.url) {
      resolvedUrl = options.url;
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
        if (options.adapter && typeof urlToProcess === "string" && urlToProcess.includes("sqlite")) {
          throw new Error(
            `Invalid URL '${urlToProcess}' for ${options.adapter}. Did you mean to specify \`{ adapter: "sqlite" }\`?`,
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
  if (options.adapter) {
    // Validate that the adapter is supported
    const supportedAdapters = ["postgres", "sqlite", "mysql", "mariadb"];
    if (!supportedAdapters.includes(options.adapter)) {
      throw new Error(
        `Unsupported adapter: ${options.adapter}. Supported adapters: "postgres", "sqlite", "mysql", "mariadb"`,
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
        query += `${key}\0${queryObject[key]}\0`;
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
  // @ts-expect-error we're exporting a const enum which works in our builtins
  // generator but not in typescript officially
  SSLMode,
};
