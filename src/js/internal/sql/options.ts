const enum SSLMode {
  disable = 0,
  prefer = 1,
  require = 2,
  verify_ca = 3,
  verify_full = 4,
}
export type { SSLMode };

type Adapter = Bun.SQL.__internal.Adapter;
type AnyOptions = Bun.SQL.__internal.AnyOptions;
type TLSOptions = Bun.SQL.TLSOptions;

const ObjectDefineProperty = Object.defineProperty;
const kInspectCustom = Symbol.for("nodejs.util.inspect.custom");
const env = Bun.env;

const SQLITE_MEMORY = ":memory:";
const SUPPORTED_ADAPTERS = `"postgres", "sqlite", "mysql", "mariadb"`;

function decodeIfValid(value: string | null | undefined): string | null {
  if (value) {
    return decodeURIComponent(value);
  }
  return null;
}

function normalizeSSLMode(value: string | undefined): SSLMode {
  if (!value) {
    return SSLMode.disable;
  }

  value = (value + "").toLowerCase();
  switch (value) {
    case "disable":
    case "disabled":
      return SSLMode.disable;
    case "allow": // libpq value; both accept either outcome, so map to prefer
    case "prefer":
    case "preferred":
      return SSLMode.prefer;
    case "require":
    case "required":
      return SSLMode.require;
    case "verify-ca":
    case "verify_ca":
      return SSLMode.verify_ca;
    case "verify-full":
    case "verify_full":
    case "verify-identity":
    case "verify_identity":
      return SSLMode.verify_full;
    default: {
      break;
    }
  }

  throw $ERR_INVALID_ARG_VALUE(
    "sslmode",
    value,
    "must be one of: disable, allow, prefer, require, verify-ca, verify-full",
  );
}

function adapterFromScheme(scheme: string): Adapter | null {
  switch (scheme) {
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

function isMySQL(adapter: Adapter): boolean {
  return adapter === "mysql" || adapter === "mariadb";
}

const SQLITE_PREFIXES = ["sqlite://", "sqlite:", "file://", "file:"];

function sqlitePrefix(value: string): string {
  const start = value.slice(0, 9).toLowerCase();
  for (const prefix of SQLITE_PREFIXES) {
    if (start.startsWith(prefix)) return prefix;
  }
  return "";
}

function schemeOf(target: string | URL): string {
  if (target instanceof URL) return target.protocol.slice(0, -1);
  if (target === SQLITE_MEMORY || sqlitePrefix(target)) return "sqlite";
  const end = target.indexOf("://");
  return end === -1 ? "" : target.slice(0, end).trim().toLowerCase();
}

// The adapter a name implies, then the names in the order they are read.
const ENVIRONMENT_URLS: [Adapter | null, ...string[]][] = [
  [null, "DATABASE_URL", "DATABASEURL", "TLS_DATABASE_URL"],
  ["postgres", "POSTGRES_URL", "PGURL", "PG_URL", "TLS_POSTGRES_DATABASE_URL"],
  ["mysql", "MYSQL_URL", "MYSQLURL", "TLS_MYSQL_DATABASE_URL"],
  ["mariadb", "MARIADB_URL", "MARIADBURL", "TLS_MARIADB_DATABASE_URL"],
  ["sqlite", "SQLITE_URL", "SQLITEURL"],
];

function urlFromEnvironment(
  adapter: Adapter | null,
): [url: string | null, adapter: Adapter | null, requireTLS: boolean] {
  for (const row of ENVIRONMENT_URLS) {
    const implied = row[0];
    if (adapter && implied && implied !== adapter) continue;

    for (let i = 1; i < row.length; i++) {
      const name = row[i] as string;
      const url = env[name];
      if (!url) continue;

      if (adapter && !implied) {
        const named = adapterFromScheme(schemeOf(url));
        if (named && named !== adapter && !(isMySQL(named) && isMySQL(adapter))) continue;
      }
      return [url, implied, name.startsWith("TLS_")];
    }
  }
  return [null, null, false];
}

/** Without `adapter`, the URL of a server in `filename`, and a `filename` next to what only a server has, is a connection string. */
function namesServer(filename: string | URL, options: AnyOptions): boolean {
  const named = adapterFromScheme(schemeOf(filename));
  if (named) return named !== "sqlite";
  return !!(
    options.hostname ||
    options.host ||
    options.port ||
    options.username ||
    options.user ||
    options.password ||
    options.pass ||
    options.database ||
    options.db ||
    options.path ||
    options.socket ||
    options.tls ||
    options.ssl
  );
}

function resolveTarget(
  first: AnyOptions | string | URL | null | undefined,
  second: AnyOptions,
): [adapter: Adapter, options: AnyOptions, target: string | URL | null, requireTLS: boolean] {
  let target: string | URL | null = null;
  if (typeof first === "string" || first instanceof URL) {
    target = first;
    first = undefined;
  }
  const options: AnyOptions = { ...first, ...second };

  let adapter: Adapter | null = options.adapter || null;
  if (adapter && adapter !== "postgres" && adapter !== "sqlite" && !isMySQL(adapter)) {
    throw new Error(`Unsupported adapter: ${adapter}. Supported adapters: ${SUPPORTED_ADAPTERS}`);
  }

  const filename = !adapter || adapter === "sqlite" ? options.filename : undefined;
  if (filename && (adapter || !namesServer(filename, options))) adapter = "sqlite";
  target = filename || options.url || target || null;

  // A URL is a unit: the credentials of one from the environment belong to its host.
  let requireTLS = false;
  if (
    target === null &&
    (adapter === "sqlite" || !(options.hostname || options.host || options.path || options.socket))
  ) {
    let implied: Adapter | null;
    [target, implied, requireTLS] = urlFromEnvironment(adapter);
    adapter ||= implied;
  }

  if (!adapter) {
    const scheme = target === null ? "" : schemeOf(target);
    adapter =
      scheme === "" || scheme === "http" || scheme === "https" || scheme === "ftp"
        ? "postgres"
        : adapterFromScheme(scheme);
    if (!adapter) {
      throw new Error(`Unsupported protocol: ${scheme}. Supported adapters: ${SUPPORTED_ADAPTERS}`);
    }
  }

  return [adapter, options, target, requireTLS];
}

function refuseRequiredChannelBinding(adapter: Adapter, channelBinding: unknown) {
  if (channelBinding === "require") {
    throw $ERR_INVALID_ARG_VALUE(
      "channelBinding",
      channelBinding,
      `is not supported by the ${adapter} adapter: channel binding is a PostgreSQL feature`,
    );
  }
}

function parseSQLiteOptions(target: string | URL | null, options: AnyOptions): Bun.SQL.__internal.DefinedSQLiteOptions {
  if ("readOnly" in options) throw new TypeError('Misspelled option "readOnly" should be "readonly"');

  let filename = (target instanceof URL ? target.href : target || "").trim();
  const prefix = sqlitePrefix(filename);
  // 0: the URL does not say. Then from the most restrictive to the least.
  let access = 0;
  let memory = filename.toLowerCase() === "sqlite:memory";
  let channelBinding: string | null | undefined = options.channelBinding;

  // Only a URL has a query: "what?.db" is a file name.
  const queryIndex = prefix || target instanceof URL ? filename.indexOf("?") : -1;
  if (queryIndex !== -1) {
    let query = filename.slice(queryIndex + 1);
    filename = filename.slice(0, queryIndex);
    const fragmentIndex = query.indexOf("#");
    if (fragmentIndex !== -1) query = query.slice(0, fragmentIndex);

    const parameters = new URLSearchParams(query);
    channelBinding ||= parameters.get("channel_binding");
    for (const mode of parameters.getAll("mode")) {
      if (mode === "memory") {
        memory = true;
        continue;
      }
      const rank = mode === "ro" ? 1 : mode === "rw" ? 2 : mode === "rwc" ? 3 : 0;
      if (rank === 0) throw $ERR_INVALID_ARG_VALUE("mode", mode, "must be one of: ro, rw, rwc, memory");
      if (access === 0 || rank < access) access = rank;
    }
  }
  refuseRequiredChannelBinding("sqlite", channelBinding);

  if (memory) {
    filename = SQLITE_MEMORY;
  } else if (prefix === "file://") {
    try {
      filename = Bun.fileURLToPath(filename);
    } catch {
      filename = filename.slice(prefix.length);
    }
  } else {
    filename = filename.slice(prefix.length);
  }

  const sqliteOptions: Bun.SQL.__internal.DefinedSQLiteOptions = {
    ...options,
    adapter: "sqlite",
    filename: filename || SQLITE_MEMORY,
  };

  // An option that is given replaces what `mode` says. `rwc` is the default.
  if (access === 1) {
    if (options.readonly === undefined) sqliteOptions.readonly = true;
  } else if (access === 2) {
    if (options.create === undefined) sqliteOptions.create = false;
  }

  const safeIntegers = options.safeIntegers ?? options.bigint;
  if (safeIntegers !== undefined) sqliteOptions.safeIntegers = safeIntegers;

  if (sqliteOptions.transform != null) sqliteOptions.transform = parseTransform(sqliteOptions.transform);

  return sqliteOptions;
}

function parseServerUrl(
  target: string | URL,
  adapter: Adapter,
  adapterOption: Adapter | undefined,
): [url: URL, hostname: string] {
  let url: URL;
  if (target instanceof URL) {
    url = target;
  } else {
    const value = target.includes("://") ? target : `${adapter}://${target}`;
    try {
      url = new URL(value);
    } catch (e) {
      // `new URL()` refuses credentials or a port without a host. libpq takes the host from elsewhere.
      const start = value.indexOf("://") + 3;
      let end = start;
      while (end < value.length && value[end] !== "/" && value[end] !== "?" && value[end] !== "#") end++;
      const host = Math.max(start, value.lastIndexOf("@", end) + 1);
      if (end > start && (host === end || value[host] === ":")) {
        const withHost = URL.parse(`${value.slice(0, host)}localhost${value.slice(host)}`);
        if (withHost) return [withHost, ""];
      }

      if (adapterOption && value.includes("sqlite")) {
        throw new Error(
          `Invalid URL '${value}' for ${adapterOption}. Did you mean to specify \`{ adapter: "sqlite" }\`?`,
          { cause: e },
        );
      }
      throw e;
    }
  }

  // libpq: the directory of a unix socket, percent-encoded
  const hostname = url.hostname;
  return [url, hostname.startsWith("%2F") || hostname.startsWith("%2f") ? decodeURIComponent(hostname) : hostname];
}

interface UrlQuery {
  __proto__: null;
  hostname?: string;
  port?: string;
  username?: string;
  password?: string;
  database?: string;
  path?: string;
  connectionTimeout?: string;
  idleTimeout?: string;
  maxLifetime?: string;
  max?: string;
  prepare?: string;
  foundRows?: string;
  channelBinding?: string;
  sslMode?: SSLMode;
  tls?: true | TLSOptions;
}

const QUERY_OPTIONS = {
  __proto__: null,
  path: "path",
  socket: "path",
  connect_timeout: "connectionTimeout",
  idle_timeout: "idleTimeout",
  max_lifetime: "maxLifetime",
  max: "max",
  prepare: "prepare",
  foundrows: "foundRows",
  channel_binding: "channelBinding",
} as const;

const LIBPQ_OPTIONS = {
  __proto__: null,
  host: "hostname",
  port: "port",
  user: "username",
  password: "password",
  dbname: "database",
} as const;

const LIBPQ_TLS_OPTIONS = {
  __proto__: null,
  sslrootcert: "caFile",
  sslcert: "certFile",
  sslkey: "keyFile",
  sslpassword: "passphrase",
} as const;

// Keywords that tune libpq itself. A server refuses them as startup parameters.
function isLibpqClientKeyword(key: string, value: string): boolean {
  switch (key) {
    case "keepalives":
    case "keepalives_idle":
    case "keepalives_interval":
    case "keepalives_count":
    case "tcp_user_timeout":
    case "target_session_attrs":
    case "load_balance_hosts":
    case "fallback_application_name":
    case "sslnegotiation":
    case "sslcompression":
      return true;
    case "gssencmode":
      return value !== "require";
    default:
      return false;
  }
}

function setStartupParameter(parameters: Record<string, string>, name: string, key: string, raw: unknown) {
  const value = `${raw}`;
  if (key.includes("\0") || value.includes("\0")) {
    throw $ERR_INVALID_ARG_VALUE(name, raw, "must not contain null bytes");
  }
  parameters[key] = value;
}

function readUrlQuery(url: URL, isPostgres: boolean, parameters: Record<string, string>): UrlQuery {
  const query: UrlQuery = { __proto__: null };
  const queryObject = url.searchParams.toJSON();
  for (const key in queryObject) {
    const value = `${queryObject[key]}`;
    const lowerKey = key.toLowerCase();
    let option: string | false | undefined;

    if (lowerKey === "sslmode" || lowerKey === "ssl-mode" || lowerKey === "ssl_mode") {
      query.sslMode = normalizeSSLMode(value);
    } else if (lowerKey === "ssl" || lowerKey === "tls") {
      const lowerValue = value.toLowerCase();
      if (lowerValue === "true" || lowerValue === "1") {
        query.tls ||= true;
      } else if (lowerValue === "false" || lowerValue === "0") {
        query.sslMode = SSLMode.disable;
      } else if (lowerValue) {
        query.sslMode = normalizeSSLMode(lowerValue);
      }
    } else if ((option = QUERY_OPTIONS[lowerKey] || (isPostgres && LIBPQ_OPTIONS[lowerKey]))) {
      if (value) query[option] ||= value;
    } else if (isPostgres && (option = LIBPQ_TLS_OPTIONS[lowerKey])) {
      if (!value) continue;
      const tls = $isObject(query.tls) ? query.tls : (query.tls = {});
      if (lowerKey === "sslrootcert" && value === "system") tls.rejectUnauthorized = true;
      else tls[option] = value;
    } else if (!isPostgres || !isLibpqClientKeyword(lowerKey, value)) {
      setStartupParameter(parameters, `options.${key}`, key, queryObject[key]);
    }
  }
  return query;
}

const NO_QUERY: UrlQuery = { __proto__: null };

function envOf(prefix: string, name: string): string | undefined {
  return env[`${prefix}_${name}`] || env[prefix + name];
}

function isDirectory(path: string): boolean {
  try {
    return require("node:fs").statSync(path, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    return false;
  }
}

function queryFlag(value: string | undefined): boolean | undefined {
  return value ? value !== "false" && value !== "0" : undefined;
}

function secondsToMilliseconds(name: string, value: unknown): number | undefined {
  if (value == null) return undefined;
  const seconds = Number(value);
  if (seconds > 2 ** 31 || seconds < 0 || seconds !== seconds) {
    throw $ERR_INVALID_ARG_VALUE(name, seconds, "must be a non-negative integer less than 2^31");
  }
  return seconds * 1000;
}

function parseTransform(transform: any): import("./shared").Transform {
  const column = $isObject(transform) ? transform.column : undefined;
  // A function is one of SQL.toCamel ... SQL.fromKebab, which say in `column` which direction they are for.
  if (!$isObject(transform) || ($isCallable(transform) && column === undefined)) {
    throw $ERR_INVALID_ARG_TYPE("transform", "object", transform);
  }
  let from, to;
  if ($isCallable(column)) {
    from = column;
  } else if ($isObject(column)) {
    ({ from, to } = column);
  } else if (column != null) {
    throw $ERR_INVALID_ARG_TYPE("transform.column", ["function", "object"], column);
  }
  if (from != null && !$isCallable(from)) {
    throw $ERR_INVALID_ARG_TYPE("transform.column.from", "function", from);
  }
  if (to != null && !$isCallable(to)) {
    throw $ERR_INVALID_ARG_TYPE("transform.column.to", "function", to);
  }
  return { undefined: (transform as $AnyObject).undefined, column: { from: from ?? undefined, to: to ?? undefined } };
}

function inspectOptions(this: Bun.SQL.__internal.DefinedPostgresOrMySQLOptions) {
  const copy = { ...this };
  if (copy.password) copy.password = "[REDACTED]";
  if ($isObject(copy.tls)) {
    const tls = { ...(copy.tls as TLSOptions) };
    if (tls.key) tls.key = "[REDACTED]";
    if (tls.passphrase) tls.passphrase = "[REDACTED]";
    copy.tls = tls;
  }
  return copy;
}

const inspectOptionsDescriptor = {
  __proto__: null,
  value: inspectOptions,
  enumerable: false,
  configurable: true,
  writable: true,
};

function parseOptions(
  stringOrUrlOrOptions: Bun.SQL.Options | string | URL | undefined,
  definitelyOptionsButMaybeEmpty: Bun.SQL.Options,
): Bun.SQL.__internal.DefinedOptions {
  const [adapter, options, target, requireTLS] = resolveTarget(stringOrUrlOrOptions, definitelyOptionsButMaybeEmpty);

  if (adapter === "sqlite") {
    return parseSQLiteOptions(target, options);
  }

  // The rest of this function is logic specific to postgres/mysql/mariadb (they have the same options object)

  const isPostgres = adapter === "postgres";
  const prefix = isPostgres ? "PG" : adapter === "mysql" ? "MYSQL" : "MARIADB";

  const parameters = { __proto__: null } as unknown as Record<string, string>;
  if (isPostgres) {
    const { PGAPPNAME, PGOPTIONS } = env;
    if (PGAPPNAME) parameters.application_name = PGAPPNAME;
    if (PGOPTIONS) parameters.options = PGOPTIONS;
  }

  let url: URL | null = null;
  let urlHostname = "";
  let query = NO_QUERY;
  if (target !== null) {
    [url, urlHostname] = parseServerUrl(target, adapter, options.adapter);
    query = readUrlQuery(url, isPostgres, parameters);
  }
  // The pathname is the database, except in unix://, where it is the socket.
  const urlPathname = url === null ? "" : url.pathname;
  const isUnixUrl = url !== null && url.protocol === "unix:";

  const connection = options.connection;
  if (connection && $isObject(connection)) {
    for (const key in connection) {
      if (connection[key] !== undefined) {
        setStartupParameter(parameters, `options.connection.${key}`, key, connection[key]);
      }
    }
  }
  let startupParameters = "";
  for (const key in parameters) {
    startupParameters += `${key}\0${parameters[key]}\0`;
  }

  // Every field: option, deprecated alias, URL query, URL, environment, default.

  let hostname =
    options.hostname || options.host || query.hostname || urlHostname || envOf(prefix, "HOST") || "localhost";

  const port = Number(options.port || query.port || url?.port || envOf(prefix, "PORT") || (isPostgres ? 5432 : 3306));
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw $ERR_INVALID_ARG_VALUE("port", port, "must be a non-negative integer between 1 and 65535");
  }

  const username =
    options.username ||
    options.user ||
    query.username ||
    decodeIfValid(url?.username) ||
    (isPostgres && env.PGUSERNAME) ||
    envOf(prefix, "USER") ||
    env.USER ||
    env.USERNAME ||
    (isPostgres ? "postgres" : "root");

  const password =
    options.password ||
    options.pass ||
    query.password ||
    decodeIfValid(url?.password) ||
    envOf(prefix, "PASSWORD") ||
    "";

  const database =
    options.database ||
    options.db ||
    query.database ||
    (!isUnixUrl && decodeIfValid(urlPathname.slice(1))) ||
    envOf(prefix, "DATABASE") ||
    (isPostgres ? username : "");

  let path =
    options.path ||
    (typeof options.socket === "string" && options.socket) ||
    query.path ||
    (isUnixUrl && urlPathname) ||
    "";

  // libpq: a host that starts with "/" is the directory of the socket.
  const hostIsPath = !path && hostname.startsWith("/");
  if (hostIsPath) {
    path = hostname;
    hostname = "localhost";
  }
  if (isPostgres && path && !path.includes("/.s.PGSQL.") && (hostIsPath || isDirectory(path))) {
    path = `${path}/.s.PGSQL.${port}`;
  }

  const idleTimeout = secondsToMilliseconds(
    "options.idle_timeout",
    options.idleTimeout ?? options.idle_timeout ?? query.idleTimeout,
  );
  const connectionTimeout = secondsToMilliseconds(
    "options.connection_timeout",
    options.connectionTimeout ??
      options.connection_timeout ??
      options.connectTimeout ??
      options.connect_timeout ??
      query.connectionTimeout ??
      ((isPostgres && env.PGCONNECT_TIMEOUT) || undefined),
  );
  const maxLifetime = secondsToMilliseconds(
    "options.max_lifetime",
    options.maxLifetime ?? options.max_lifetime ?? query.maxLifetime,
  );

  const max = Number(options.max ?? query.max ?? 10);
  if (max > 2 ** 31 || max < 1 || max !== max) {
    throw $ERR_INVALID_ARG_VALUE("options.max", max, "must be a non-negative integer between 1 and 2^31");
  }

  const prepare = (options.prepare ?? queryFlag(query.prepare)) !== false;
  if (!prepare && !isPostgres) {
    throw $ERR_INVALID_ARG_VALUE("options.prepare", false, "prepared: false is not supported in MySQL");
  }

  const channelBinding = (options.channelBinding ||
    query.channelBinding ||
    (isPostgres && env.PGCHANNELBINDING) ||
    "prefer") as Bun.SQL.__internal.ChannelBinding;
  if (channelBinding !== "disable" && channelBinding !== "prefer" && channelBinding !== "require") {
    throw $ERR_INVALID_ARG_VALUE("channelBinding", channelBinding, "must be one of: disable, prefer, require");
  }
  if (!isPostgres) refuseRequiredChannelBinding(adapter, channelBinding);

  const { onconnect, onclose, transform: transformOption } = options;
  if (onconnect !== undefined && !$isCallable(onconnect)) {
    throw $ERR_INVALID_ARG_TYPE("onconnect", "function", onconnect);
  }
  if (onclose !== undefined && !$isCallable(onclose)) {
    throw $ERR_INVALID_ARG_TYPE("onclose", "function", onclose);
  }
  const transform = transformOption != null ? parseTransform(transformOption) : undefined;

  let sslMode: SSLMode = isPostgres ? normalizeSSLMode(envOf(prefix, "SSLMODE")) : SSLMode.disable;
  sslMode = query.sslMode ?? sslMode;

  let tls: TLSOptions | (Bun.BunFile & TLSOptions) | boolean | undefined;
  const { tls: optionsTls, ssl: optionsSsl } = options;
  const tlsOption = optionsTls || optionsSsl;
  if (typeof tlsOption === "string" && tlsOption) {
    sslMode = normalizeSSLMode(tlsOption);
  } else if (!tlsOption && (optionsTls === false || optionsSsl === false)) {
    sslMode = SSLMode.disable;
  } else if ($inheritsBlob(tlsOption)) {
    // A `Bun.file()` is the CA bundle to verify the server certificate against.
    tls = { ca: tlsOption };
  } else {
    tls = tlsOption || query.tls;
  }

  // Explicit tls/ssl options request an encrypted connection: if the server
  // declines TLS, the connection is aborted instead of continuing in plaintext.
  // Certificate verification is only enabled when explicitly requested
  // (ca, caFile, checkServerIdentity, rejectUnauthorized, or a verify-* sslmode).
  // The name of a TLS_* URL variable is a floor: no mode that the URL or an option names goes below it.
  if ((tls || requireTLS) && sslMode <= SSLMode.prefer) {
    sslMode = SSLMode.require;
  }

  const tlsObject = {
    __proto__: null,
    ...(query.tls as Exclude<typeof tls, boolean>),
    ...(tls as Exclude<typeof tls, boolean>),
  } as unknown as TLSOptions;
  const { rejectUnauthorized, checkServerIdentity } = tlsObject;
  if (checkServerIdentity !== undefined && !$isCallable(checkServerIdentity)) {
    throw $ERR_INVALID_ARG_TYPE("tls.checkServerIdentity", "function", checkServerIdentity);
  }
  if (sslMode !== SSLMode.disable && sslMode < SSLMode.verify_ca) {
    if (
      rejectUnauthorized === true ||
      (rejectUnauthorized !== false && (tlsObject.ca || tlsObject.caFile || checkServerIdentity))
    ) {
      sslMode = SSLMode.verify_full;
    }
  }

  // `tls` is read before its alias; a mode the alias names still counts.
  if (optionsTls && typeof optionsSsl === "string") {
    const aliasMode = normalizeSSLMode(optionsSsl);
    if (aliasMode > sslMode) sslMode = aliasMode;
  }

  if (isPostgres && path) {
    // libpq: "sslmode is ignored for Unix domain socket communication"
    sslMode = SSLMode.disable;
    tls = undefined;
  } else if (sslMode !== SSLMode.disable && (tls === undefined || tls === true || $isObject(tls))) {
    // The native constructor rejects any other `tls`.
    tlsObject.serverName ||= tlsObject.servername || hostname;
    // As explicit as `rejectUnauthorized: true`, so NODE_TLS_REJECT_UNAUTHORIZED is not asked.
    if (sslMode >= SSLMode.verify_ca && rejectUnauthorized !== false) tlsObject.rejectUnauthorized = true;
    tls = tlsObject;
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
    foundRows: !!(options.foundRows ?? queryFlag(query.foundRows) ?? true),
    channelBinding,
    bigint: options.bigint,
    sslMode,
    query: startupParameters,
    max,
  };
  ObjectDefineProperty(ret, kInspectCustom, inspectOptionsDescriptor);

  if (idleTimeout !== undefined) {
    ret.idleTimeout = idleTimeout;
  }

  if (connectionTimeout !== undefined) {
    ret.connectionTimeout = connectionTimeout;
  }

  if (maxLifetime !== undefined) {
    ret.maxLifetime = maxLifetime;
  }

  if (onconnect !== undefined) {
    ret.onconnect = onconnect;
  }

  if (onclose !== undefined) {
    ret.onclose = onclose;
  }

  if (transform !== undefined) {
    ret.transform = transform;
  }

  if (path) {
    ret.path = path;
  }

  return ret;
}

export default {
  parseOptions,
};
