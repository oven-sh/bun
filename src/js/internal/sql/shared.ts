declare global {
  interface NumberConstructor {
    isSafeInteger(number: unknown): number is number;
    isNaN(number: number): boolean;
  }
}

function decodeIfValid(value: string | null): string | null {
  if (value) {
    return decodeURIComponent(value);
  }
  return null;
}

enum SSLMode {
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
    if (keys !== undefined && keys.length === 0) {
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

class UnsupportedAdapterError extends Error {
  public options: Bun.SQL.Options;

  constructor(options: Bun.SQL.Options) {
    super(`Unsupported adapter: ${options.adapter}. Supported adapters: "postgres", "sqlite"`);
    this.options = options;
  }
}

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
    throw new Error(`Expected adapter to be ${adapter}, but got '${options.adapter}'`);
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

  // @ts-expect-error Compatibility
  if (options.adapter === "postgresql") options.adapter = "postgres";

  assertIsOptionsOfAdapter(options, "postgres");

  // TODO: Better typing for these vars
  let hostname: any,
    port: number | string | undefined,
    username: string | null | undefined,
    password: string | (() => Bun.MaybePromise<string>) | undefined | null,
    database: any,
    tls: Bun.TLSOptions | boolean | undefined,
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
  let sslMode: SSLMode = SSLMode.disable;

  // Check environment variables if no URL was provided
  const shouldCheckEnv =
    stringOrUrl === undefined ||
    stringOrUrl === null ||
    (typeof stringOrUrl === "string" && stringOrUrl.length === 0) ||
    (stringOrUrl &&
      typeof stringOrUrl === "object" &&
      !(stringOrUrl instanceof URL) &&
      !options?.url &&
      !options?.hostname &&
      !options?.host);

  if (shouldCheckEnv) {
    let urlString = Bun.env.POSTGRES_URL || Bun.env.DATABASE_URL || Bun.env.PGURL || Bun.env.PG_URL;

    if (!urlString) {
      urlString = Bun.env.TLS_POSTGRES_DATABASE_URL || Bun.env.TLS_DATABASE_URL;

      if (urlString) {
        sslMode = SSLMode.require;
      }
    }

    if (urlString) {
      url = new URL(urlString);
    }
  } else if (stringOrUrl && typeof stringOrUrl === "object") {
    if (stringOrUrl instanceof URL) {
      url = stringOrUrl;
    } else if (options?.url) {
      // stringOrUrl is an options object with a url property
      const _url = options.url;
      if (typeof _url === "string") {
        url = new URL(_url);
      } else if (_url && typeof _url === "object" && _url instanceof URL) {
        url = _url;
      }
    }
  } else if (typeof stringOrUrl === "string") {
    url = new URL(stringOrUrl);
  }

  if (options?.tls) {
    sslMode = SSLMode.require;
    tls = options.tls;
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
  hostname ||= options.hostname || options.host || Bun.env.PGHOST || "localhost";

  port ||= Number(options.port || Bun.env.PGPORT || 5432);

  path ||= (options as { path?: string }).path || "";
  // add /.s.PGSQL.${port} if it doesn't exist
  if (path && path?.indexOf("/.s.PGSQL.") === -1) {
    path = `${path}/.s.PGSQL.${port}`;
  }

  username ||=
    options.username ||
    options.user ||
    Bun.env.PGUSERNAME ||
    Bun.env.PGUSER ||
    Bun.env.USER ||
    Bun.env.USERNAME ||
    "postgres";
  database ||=
    options.database || options.db || decodeIfValid((url?.pathname ?? "").slice(1)) || Bun.env.PGDATABASE || username;
  password ||= options.password || options.pass || Bun.env.PGPASSWORD || "";
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

export default {
  parseDefinitelySqliteUrl,
  isOptionsOfAdapter,
  assertIsOptionsOfAdapter,
  parseOptions,
  UnsupportedAdapterError,
  SQLHelper,
  SSLMode,
  normalizeSSLMode,
};
