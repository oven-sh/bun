import type * as BunSQLite from "bun:sqlite";

declare module "bun" {
  /**
   * A connection reserved from the pool with {@link SQL.reserve}. Call
   * {@link release} to return it to the pool.
   *
   * After `release()`, a query on this client that has not started rejects
   * with `ERR_POSTGRES_CONNECTION_CLOSED` or `ERR_MYSQL_CONNECTION_CLOSED`.
   * Queries are lazy, so this includes a query that a `using` block returns
   * without `await`.
   */
  interface ReservedSQL extends SQL, Disposable {
    /**
     * Releases the connection back to the pool.
     *
     * The client closes immediately: new queries and `begin()` calls reject.
     * A transaction started with `begin()` on this client keeps the
     * connection until it ends, and the pool gets the connection back after
     * that. The returned promise resolves right away, so you can await
     * `release()` inside such a transaction.
     *
     * Bun closes a connection that is released inside an open transaction,
     * for example after a manual `BEGIN`, instead of returning it to the pool.
     */
    release(): Promise<void>;

    /**
     * Closes the connection instead of returning it to the pool.
     *
     * @param options `timeout` is how many seconds to wait for the running
     * queries of this client. The default is `0`.
     */
    close(options?: { timeout?: number }): Promise<void>;
  }

  type ArrayType =
    | "BOOLEAN"
    | "BYTEA"
    | "CHAR"
    | "NAME"
    | "TEXT"
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
    | "UUID"
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

  /**
   * An array parameter created by {@link SQL.array}
   */
  interface SQLArrayParameter {
    /**
     * The array values, serialized into a single string
     */
    serializedValues: string;
    /**
     * The element type of the array, for example `"INT"`. `undefined` when
     * no type was given: Bun adds no cast, and the server infers the type.
     */
    arrayType: ArrayType | undefined;
  }

  /**
   * A JSON parameter created by {@link SQL.json} on PostgreSQL
   */
  interface SQLJSONParameter {
    value: unknown;
    toJSON(key: string): unknown;
  }

  /**
   * The client passed to transaction callbacks ({@link SQL.begin},
   * {@link SQL.transaction}). Extends {@link SQL} with savepoints.
   *
   * The client belongs to its transaction. Once `COMMIT` or `ROLLBACK` is
   * sent, a query on it never reaches the database. It rejects with
   * `ERR_POSTGRES_INVALID_TRANSACTION_STATE` (or the `MYSQL` / `SQLITE`
   * code), even if it was created inside the callback. Await every query
   * inside the callback, or return the queries in an array.
   */
  interface TransactionSQL extends SQL {
    /**
     * Creates a savepoint within the current transaction.
     *
     * The callback gets a client of its own, which ends with the savepoint.
     * `savepoint` resolves with the callback's return value. If the callback
     * throws, Bun rolls back to the savepoint and `savepoint` rejects with
     * the error: catch it to continue the transaction.
     *
     * Run the savepoints of one transaction one after the other. A savepoint
     * holds every statement that the connection runs while it is open, so a
     * savepoint that fails also rolls back the work of one that runs next to
     * it.
     *
     * @param name A label. Bun appends it to the name it generates, for
     * example `SAVEPOINT s0_audit` for `"audit"`. Each character that is not
     * an ASCII letter, a digit or `_` becomes `_`.
     */
    savepoint<T>(name: string, fn: SQL.SavepointContextCallback<T>): Promise<SQL.ContextCallbackResult<T>>;
    savepoint<T>(fn: SQL.SavepointContextCallback<T>): Promise<SQL.ContextCallbackResult<T>>;

    /**
     * Rolls the transaction back. {@link SQL.begin} then rejects with
     * `ERR_POSTGRES_CONNECTION_CLOSED` (or the `MYSQL` / `SQLITE` code).
     *
     * @param options `timeout` is how many seconds to wait for the running
     * queries of the transaction before Bun sends `ROLLBACK`. The default is
     * `0`.
     */
    close(options?: { timeout?: number }): Promise<void>;

    /**
     * Reserves a connection from the pool and returns a client that wraps
     * that single connection.
     *
     * Inside a transaction, `reserve()` returns a brand new connection, not
     * one related to the transaction. This matches the behaviour of the
     * `postgres` package.
     *
     * @param options `signal` aborts the reservation while it is still
     * waiting for a connection; the returned promise rejects with
     * `signal.reason` and no connection is taken from the pool.
     */
    reserve(options?: { signal?: AbortSignal }): Promise<ReservedSQL>;
  }

  namespace SQL {
    class SQLError extends Error {
      constructor(message: string);
    }

    class PostgresError extends SQLError {
      /**
       * Bun's error code, such as `"ERR_POSTGRES_SERVER_ERROR"` or
       * `"ERR_POSTGRES_CONNECTION_CLOSED"`. The server's own code is in
       * {@link errno}.
       */
      public readonly code: string;
      /**
       * The SQLSTATE that the server sent, such as `"23505"` for a unique
       * violation. Not set on errors that Bun raises itself.
       */
      public readonly errno?: string | undefined;
      public readonly detail?: string | undefined;
      public readonly hint?: string | undefined;
      public readonly severity?: string | undefined;
      public readonly position?: string | undefined;
      public readonly internalPosition?: string | undefined;
      public readonly internalQuery?: string | undefined;
      public readonly where?: string | undefined;
      public readonly schema?: string | undefined;
      public readonly table?: string | undefined;
      public readonly column?: string | undefined;
      public readonly dataType?: string | undefined;
      public readonly constraint?: string | undefined;
      public readonly file?: string | undefined;
      public readonly line?: string | undefined;
      public readonly routine?: string | undefined;

      constructor(
        message: string,
        options: {
          code: string;
          errno?: string | undefined;
          detail?: string;
          hint?: string | undefined;
          severity?: string | undefined;
          position?: string | undefined;
          internalPosition?: string;
          internalQuery?: string;
          where?: string | undefined;
          schema?: string;
          table?: string | undefined;
          column?: string | undefined;
          dataType?: string | undefined;
          constraint?: string;
          file?: string | undefined;
          line?: string | undefined;
          routine?: string | undefined;
        },
      );
    }

    class MySQLError extends SQLError {
      /**
       * Bun's error code, such as `"ERR_MYSQL_SERVER_ERROR"` or
       * `"ERR_MYSQL_CONNECTION_CLOSED"`. It is not a name like
       * `ER_DUP_ENTRY`: compare {@link errno} for that.
       */
      public readonly code: string;
      /**
       * The error number that the server sent, such as `1062` for a
       * duplicate entry. Not set on errors that Bun raises itself.
       */
      public readonly errno?: number | undefined;
      /** The SQLSTATE that the server sent, such as `"23000"` */
      public readonly sqlState?: string | undefined;
      constructor(message: string, options: { code: string; errno: number | undefined; sqlState: string | undefined });
    }

    class SQLiteError extends SQLError {
      /**
       * SQLite's extended result code, such as `"SQLITE_CONSTRAINT_UNIQUE"`,
       * or one of Bun's own codes, such as `"ERR_SQLITE_CONNECTION_CLOSED"`
       */
      public readonly code: string;
      /**
       * The number of the extended result code, such as `2067`.
       * `errno & 0xff` is the primary code. `0` on errors that Bun raises
       * itself.
       */
      public readonly errno: number;
      /**
       * The UTF-8 byte offset of the token that the error refers to, counted
       * from the start of the query text. `-1` if the error refers to no
       * token. Not set on errors that Bun raises itself.
       */
      public readonly byteOffset?: number | undefined;

      constructor(message: string, options: { code: string; errno: number; byteOffset?: number | undefined });
    }

    type AwaitPromisesArray<T extends Array<PromiseLike<any>>> = {
      [K in keyof T]: Awaited<T[K]>;
    };

    type ContextCallbackResult<T> = T extends Array<PromiseLike<any>> ? AwaitPromisesArray<T> : Awaited<T>;
    type ContextCallback<T, SQL> = (sql: SQL) => Bun.MaybePromise<T>;

    /**
     * TLS options of a PostgreSQL or MySQL connection
     */
    interface TLSOptions extends Bun.TLSOptions {
      /**
       * Replaces the built-in check of the host name against the server's
       * certificate, as in `node:tls`. To keep that check, call
       * `checkServerIdentity()` from `node:tls` inside the function.
       *
       * Bun calls it once for each connection, after the certificate chain
       * verified and before it sends the user name or the password. Like `ca`,
       * it raises an SSL mode below `"verify-ca"` to `"verify-full"`. Bun does
       * not call it with `rejectUnauthorized: false`.
       *
       * @param hostname `serverName`, or else the host that Bun connects to
       * @param cert The server's certificate. It has no `issuerCertificate`.
       * @returns `undefined` to accept the certificate. A returned or thrown
       * `Error` fails the connection with that error. The function must be
       * synchronous: a promise fails the connection too.
       *
       * @example
       * ```ts
       * const sql = new SQL(url, {
       *   tls: {
       *     ca: Bun.file("./ca.pem"),
       *     checkServerIdentity: (hostname, cert) =>
       *       cert.fingerprint256 === pin ? undefined : new Error("certificate pin mismatch"),
       *   },
       * });
       * ```
       */
      checkServerIdentity?: NonNullable<import("node:tls").ConnectionOptions["checkServerIdentity"]> | undefined;
    }

    /**
     * The two directions of {@link Transform.column}
     */
    interface ColumnTransform {
      /**
       * Renames a column that comes from the database: the keys of the row
       * objects, and `name` in {@link ResultMetadata.columns}.
       *
       * Bun calls it once for each column of a statement, not once for each
       * row, so it must return the same name every time.
       */
      from?: ((name: string) => string) | undefined;
      /**
       * Renames a name that goes to the database: the keys of `sql(object)`,
       * the columns picked in `sql(object, "a", "b")`, and every
       * `sql("name")`, table names included.
       */
      to?: ((name: string) => string) | undefined;
    }

    /**
     * The `transform` option
     *
     * @example
     * ```ts
     * const sql = new SQL({ transform: SQL.camel });
     * await sql`INSERT INTO users ${sql({ firstName: "Alice" })}`; // "first_name"
     * const [user] = await sql`SELECT first_name FROM users`;
     * console.log(user.firstName);
     * ```
     */
    interface Transform {
      /**
       * Renames columns. A function means {@link ColumnTransform.from}.
       */
      column?: ((name: string) => string) | ColumnTransform | undefined;
      /**
       * The value that Bun sends for an `undefined` parameter. When it is set
       * (`null` counts), the insert and update helpers leave no column out.
       * Without it, `undefined` is `NULL`, and the helpers leave out a column
       * that is `undefined`.
       */
      undefined?: unknown;
    }

    /**
     * One of `SQL.toCamel`, `SQL.fromCamel` and the like. Call it to convert a
     * name, or pass it as the `transform` option to rename in one direction.
     */
    interface NameTransform {
      (name: string): string;
      readonly column: ColumnTransform;
    }

    /** `transform` preset: `user_id` in the database, `userId` in JavaScript */
    const camel: { readonly column: Required<ColumnTransform> };
    /** `transform` preset: `user_id` in the database, `UserId` in JavaScript */
    const pascal: { readonly column: Required<ColumnTransform> };
    /** `transform` preset: `user_id` in the database, `user-id` in JavaScript */
    const kebab: { readonly column: Required<ColumnTransform> };
    /** `"user_id"` to `"userId"`. As `transform`, renames the columns of results only. */
    const toCamel: NameTransform;
    /** `"user_id"` to `"UserId"`. As `transform`, renames the columns of results only. */
    const toPascal: NameTransform;
    /** `"user_id"` to `"user-id"`. As `transform`, renames the columns of results only. */
    const toKebab: NameTransform;
    /** `"userId"` to `"user_id"`. As `transform`, renames the names in `sql()` helpers only. */
    const fromCamel: NameTransform;
    /** `"UserId"` to `"user_id"`. As `transform`, renames the names in `sql()` helpers only. */
    const fromPascal: NameTransform;
    /** `"user-id"` to `"user_id"`. As `transform`, renames the names in `sql()` helpers only. */
    const fromKebab: NameTransform;

    interface SQLiteOptions extends BunSQLite.DatabaseOptions {
      /**
       * Selects the SQLite adapter. Optional when {@link filename} is set,
       * because a `filename` selects SQLite too.
       */
      adapter?: "sqlite";

      /**
       * Path to the database file
       *
       * Examples:
       *
       * - `sqlite://:memory:`
       * - `sqlite://./path/to/database.db`
       * - `sqlite:///Users/bun/projects/my-app/database.db`
       * - `./dev.db`
       * - `:memory:`
       *
       * Everything from the first `?` is a query string, which can have
       * `mode=`: `ro` (read-only), `rw` (read-write, the file must exist) or
       * `rwc` (read-write and create, the default). `memory` has no effect, and
       * any other mode throws. The `readonly` and `create` options take
       * priority over it, and a read-only database ignores `create` and
       * `readwrite`.
       *
       * Without a `filename`, Bun reads a `DATABASE_URL` that is not a
       * PostgreSQL, MySQL or MariaDB URL, then `SQLITE_URL`.
       *
       * @default ":memory:"
       */
      filename?: URL | ":memory:" | (string & {}) | undefined;

      /**
       * The same as {@link filename}, which takes priority. Needs
       * `adapter: "sqlite"` unless the value is a `sqlite:` or `file:` URL.
       */
      url?: URL | string | undefined;

      /**
       * Return every integer as a `BigInt`. The same as `safeIntegers`, under
       * the name that the other adapters use. `safeIntegers` takes priority.
       * @default false
       */
      bigint?: boolean | undefined;

      /**
       * Renames columns between the database and JavaScript, for example
       * {@link SQL.camel}
       */
      transform?: Transform | NameTransform | undefined;

      /**
       * SQLite: called once, when Bun has tried to open the database. Receives
       * `null`, or the `Error` that kept it from opening (for example
       * `SQLITE_CANTOPEN`).
       */
      onconnect?: ((err: Error | null) => void) | undefined;

      /**
       * SQLite: called when {@link SQL.close} closes the database. Receives an
       * `Error` with the message `"Connection closed"`, not `null`.
       */
      onclose?: ((err: Error | null) => void) | undefined;
    }

    interface PostgresOrMySQLOptions {
      /**
       * Connection URL, for example `postgres://user:pass@localhost:5432/mydb`.
       *
       * For each setting, an option takes priority over the URL, and the URL
       * over the environment. Without `url` and without a connection string,
       * Bun reads a URL from the environment, such as `DATABASE_URL`, and the
       * other options change single fields of it.
       *
       * With `adapter`, a `DATABASE_URL` that names another adapter's server is
       * not used, except for the TLS mode it asks for when no other URL applies.
       */
      url?: URL | string | undefined;

      /**
       * Database server hostname
       * @deprecated Prefer {@link hostname}
       * @default "localhost"
       */
      host?: string | undefined;

      /**
       * Database server hostname. For PostgreSQL, a value that starts with `/`
       * is the directory of a unix socket.
       * @default "localhost"
       */
      hostname?: string | undefined;

      /**
       * Database server port number
       * @default 5432 for PostgreSQL, 3306 for MySQL and MariaDB
       */
      port?: number | string | undefined;

      /**
       * Database user for authentication
       * @default The `USER` or `USERNAME` environment variable, then "postgres" for PostgreSQL, "root" for MySQL and MariaDB
       */
      username?: string | undefined;

      /**
       * Database user for authentication (alias for username)
       * @deprecated Prefer {@link username}
       */
      user?: string | undefined;

      /**
       * Database password for authentication
       * @default ""
       */
      password?: string | (() => MaybePromise<string>) | undefined;

      /**
       * Database password for authentication (alias for password)
       * @deprecated Prefer {@link password}
       * @default ""
       */
      pass?: string | (() => MaybePromise<string>) | undefined;

      /**
       * Name of the database to connect to. `PGDATABASE`, `MYSQL_DATABASE` and
       * `MARIADB_DATABASE` take priority over the database in a URL.
       * @default The username value for PostgreSQL, `"mysql"` for MySQL. MariaDB selects no database
       */
      database?: string | undefined;

      /**
       * Name of the database to connect to (alias for database)
       * @deprecated Prefer {@link database}
       */
      db?: string | undefined;

      /**
       * Database adapter/driver to use. Takes priority over the protocol of
       * the URL. `"mariadb"` uses the MySQL driver and reads the `MARIADB_*`
       * environment variables instead of `MYSQL_*`.
       * @default The protocol of the URL, then "postgres"
       */
      adapter?: "postgres" | "mysql" | "mariadb";

      /**
       * Maximum time in seconds a connection can sit idle before it is closed.
       * A connection that runs a query, is reserved, or has an open
       * transaction is not idle.
       * @default 0 (no timeout)
       */
      idleTimeout?: number | undefined;

      /**
       * Maximum time in seconds a connection can sit idle before it is closed (alias for idleTimeout)
       * @deprecated Prefer {@link idleTimeout}
       * @default 0 (no timeout)
       */
      idle_timeout?: number | undefined;

      /**
       * Maximum time in seconds to wait when establishing a connection. Does
       * not limit how long a query runs.
       * @default 30
       */
      connectionTimeout?: number | undefined;

      /**
       * Maximum time in seconds to wait when establishing a connection (alias for connectionTimeout)
       * @deprecated Prefer {@link connectionTimeout}
       * @default 30
       */
      connection_timeout?: number | undefined;

      /**
       * Maximum time in seconds to wait when establishing a connection (alias
       * for connectionTimeout)
       * @deprecated Prefer {@link connectionTimeout}
       * @default 30
       */
      connectTimeout?: number | undefined;

      /**
       * Maximum time in seconds to wait when establishing a connection (alias
       * for connectionTimeout)
       * @deprecated Prefer {@link connectionTimeout}
       * @default 30
       */
      connect_timeout?: number | undefined;

      /**
       * Maximum lifetime in seconds of a connection. A connection that is
       * busy at that moment finishes its queries, its transaction or its
       * reservation first. It takes no new queries, and then closes.
       * @default 0 (no maximum lifetime)
       */
      maxLifetime?: number | undefined;

      /**
       * Maximum lifetime in seconds of a connection (alias for maxLifetime)
       * @deprecated Prefer {@link maxLifetime}
       * @default 0 (no maximum lifetime)
       */
      max_lifetime?: number | undefined;

      /**
       * Whether to use TLS/SSL for the connection. A string selects the
       * SSL mode (`"disable"`, `"allow"`, `"prefer"`, `"require"`, `"verify-ca"`, `"verify-full"`).
       * A `BunFile` is the CA certificate to verify the server against, the
       * same as `{ ca: Bun.file(path) }`, and selects `"verify-full"`.
       *
       * `true` and an options object ask for at least `"require"`. An object
       * with `ca`, `caFile`, `checkServerIdentity` or
       * `rejectUnauthorized: true` raises a mode below `"verify-ca"` to
       * `"verify-full"`. Without `rejectUnauthorized`,
       * `NODE_TLS_REJECT_UNAUTHORIZED=0` turns certificate verification off in
       * every mode. PostgreSQL ignores this option on a unix socket.
       *
       * A URL that Bun reads from a `TLS_*` environment variable uses
       * `"require"` unless the URL or this option names a mode.
       * @default false
       * @example
       * ```ts
       * const sql = new SQL(url, { tls: Bun.file("./rds-ca-bundle.pem") });
       * ```
       */
      tls?:
        | Bun.BunFile
        | TLSOptions
        | boolean
        | "disable"
        | "allow"
        | "prefer"
        | "require"
        | "verify-ca"
        | "verify-full"
        | undefined;

      /**
       * Whether to use TLS/SSL for the connection (alias for tls)
       * @deprecated Prefer {@link tls}
       * @default false
       */
      ssl?:
        | Bun.BunFile
        | TLSOptions
        | boolean
        | "disable"
        | "allow"
        | "prefer"
        | "require"
        | "verify-ca"
        | "verify-full"
        | undefined;

      /**
       * Unix domain socket to connect through instead of TCP to
       * `hostname:port`. For PostgreSQL, a directory resolves to
       * `<path>/.s.PGSQL.<port>`. A path that does not exist fails the
       * connection. Also the `?path=` parameter of the URL.
       * @default undefined
       */
      path?: string | undefined;

      /**
       * Unix domain socket to connect through (alias for {@link path}). Also
       * the `?socket=` parameter of the URL.
       * @default undefined
       */
      socket?: string | undefined;

      /**
       * PostgreSQL and MySQL: called once for each connection that opens,
       * always with `null`. Bun reports a failed connection attempt to
       * {@link onclose}, not here.
       */
      onconnect?: ((err: Error | null) => void) | undefined;

      /**
       * PostgreSQL and MySQL: called once for each connection that closes or
       * fails to connect, with the `Error` that says why. It is never `null`:
       * after {@link SQL.close} the code is `ERR_POSTGRES_CONNECTION_CLOSED` or
       * `ERR_MYSQL_CONNECTION_CLOSED`. A failed attempt passes its own error,
       * for example `ERR_POSTGRES_CONNECTION_REFUSED`.
       */
      onclose?: ((err: Error | null) => void) | undefined;

      /**
       * PostgreSQL only. Runtime configuration parameters that Bun sends when
       * it opens a connection, for example
       * `{ application_name: "api", search_path: "app" }`.
       *
       * @see https://www.postgresql.org/docs/current/runtime-config-client.html
       */
      connection?: Record<string, string | boolean | number> | undefined;

      /**
       * Maximum number of connections in the pool
       * @default 10
       */
      max?: number | undefined;

      /**
       * Return large integers as `BigInt`. By default they are returned as
       * strings.
       *
       * PostgreSQL: every `int8`, whatever its value. MySQL: `BIGINT` values
       * outside the 32-bit range, and a `lastInsertRowid` above
       * `Number.MAX_SAFE_INTEGER`.
       * @default false
       */
      bigint?: boolean | undefined;

      /**
       * PostgreSQL only. Use named prepared statements. Each connection keeps
       * the 1,024 it used last. `false` throws for MySQL and does nothing for
       * MariaDB.
       * @default true
       */
      prepare?: boolean | undefined;

      /**
       * MySQL only. Allow the client to request the server's RSA public key
       * during `caching_sha2_password` / `sha256_password` authentication when
       * the connection is not protected by TLS. Disabled by default because a
       * network attacker can substitute their own key and recover the
       * plaintext password. Enable only for trusted local connections, or use
       * TLS instead. Not needed over TLS, where Bun sends the password
       * directly. `caching_sha2_password` does not need it over a unix socket
       * either. `sha256_password` does.
       * @default false
       */
      allowPublicKeyRetrieval?: boolean | undefined;

      /**
       * MySQL and MariaDB only. Report the rows that the `WHERE` clause of an
       * `UPDATE` matched in `affectedRows`, as `mysql2`, the `mariadb`
       * connector, PostgreSQL and SQLite do. Without it, the server counts
       * only the rows whose values changed, so an `UPDATE` that sets a row to
       * the values it already has reports `0`. Also the `?foundRows=`
       * parameter of the URL.
       * @default false
       */
      foundRows?: boolean | undefined;

      /**
       * PostgreSQL only. Whether a SCRAM login over TLS is tied to the server's
       * certificate (SCRAM-SHA-256-PLUS), so that someone who terminates TLS
       * between the client and the server cannot pass the login on.
       *
       * - `"prefer"`: binds the login when the connection uses TLS and the
       *   server offers it
       * - `"require"`: only accepts a bound login. Otherwise the connection
       *   fails with `ERR_POSTGRES_CHANNEL_BINDING_REQUIRED`: without TLS, and
       *   when the server asks for an MD5 password, a clear text password, or
       *   none.
       * - `"disable"`: never binds the login
       *
       * Also the `?channel_binding=` parameter of the URL, and the
       * `PGCHANNELBINDING` environment variable.
       *
       * On MySQL and MariaDB, `"require"` throws when the client is created,
       * and the other values have no effect.
       * @default "disable"
       */
      channelBinding?: "disable" | "prefer" | "require" | undefined;

      /**
       * Renames columns between the database and JavaScript, for example
       * {@link SQL.camel}
       */
      transform?: Transform | NameTransform | undefined;
    }

    /**
     * Configuration options for SQL client connection and behavior
     *
     * @example
     * ```ts
     * const config: Bun.SQL.Options = {
     *   hostname: 'localhost',
     *   port: 5432,
     *   username: 'dbuser',
     *   password: 'secretpass',
     *   database: 'myapp',
     *   idleTimeout: 30,
     *   max: 20,
     *   onconnect: (err) => {
     *     if (!err) console.log('Connected to database');
     *   }
     * };
     * ```
     */
    type Options = SQLiteOptions | PostgresOrMySQLOptions;

    /** One registration made by {@link SQL.listen}. */
    interface ListenSubscription extends AsyncDisposable {
      readonly channel: string;
      /**
       * Remove this registration. Resolves once the channel is no longer
       * subscribed, or immediately when other registrations on it remain.
       * Idempotent; `await using` calls it at the end of the scope.
       */
      unlisten(): Promise<void>;
    }

    /**
     * A column of a PostgreSQL or MySQL result, as the server described it
     *
     * @example
     * ```ts
     * const result = await sql`SELECT id, data FROM posts`;
     * console.log(result.columns);
     * // PostgreSQL:
     * // [
     * //   { name: "id", type: 23, table: 16388, number: 1 }, // int4
     * //   { name: "data", type: 3802, table: 16388, number: 2 }, // jsonb
     * // ]
     * ```
     */
    interface ResultColumn {
      /** The name of the column in the result */
      name: string;
      /**
       * The type of the column.
       *
       * - PostgreSQL: the OID of the type, such as `23` for `int4`, `25` for
       *   `text`, `1009` for `text[]`, `3802` for `jsonb`
       * - MySQL: the type code of the protocol, such as `3` for `INT`, `8` for
       *   `BIGINT`, `253` for `VARCHAR`, `245` for `JSON`
       */
      type: number;
      /**
       * The table that the column comes from.
       *
       * - PostgreSQL: the OID of the table. `0` for an expression.
       * - MySQL: the name of the table, or its alias in the query. `""` for an
       *   expression.
       */
      table: number | string;
      /**
       * PostgreSQL only. The number of the column in its table, from `1`. `0`
       * for an expression, negative for a system column such as `ctid`.
       */
      number?: number;
      /** MySQL only. The length of the column, as the server sent it */
      length?: number;
      /** MySQL only. The flags of the column, as the server sent them */
      flags?: number;
    }

    /**
     * The statement that produced a PostgreSQL or MySQL result.
     *
     * The runs of one prepared statement on one connection share one object.
     * Treat it as read-only.
     */
    interface ResultStatement {
      /** The text that Bun sent, with `$1` or `?` for each parameter */
      string: string;
      /**
       * The types of the parameters, as the server reported them: OIDs on
       * PostgreSQL, type codes on MySQL. MariaDB does not type parameters, so
       * each one is `6`. Empty for a query without parameters.
       */
      types: number[];
      /** The same array as {@link ResultMetadata.columns} */
      columns: ResultColumn[];
    }

    /**
     * Properties of the array that a query resolves to, next to the rows.
     * They are accessors on the prototype, not own properties, so
     * `console.log`, `Object.keys`, `JSON.stringify` and spreading only see
     * the rows.
     *
     * A query with several statements (`.simple()`, a MySQL `CALL`) resolves
     * to a plain array of results. The metadata is on each inner array.
     */
    interface ResultMetadata {
      /**
       * The number of rows returned, or the number of rows written when the
       * statement returns none
       */
      count: number;
      /**
       * The number of rows that an `INSERT`, `UPDATE`, `DELETE` or `MERGE`
       * wrote. `0` for a statement that writes nothing.
       *
       * PostgreSQL tags `CREATE TABLE AS`, and a `SELECT` whose CTE writes, as
       * `SELECT`, so it is `0` for them. MariaDB reports
       * `INSERT ... RETURNING` as a result set, so it is `0` there too.
       */
      affectedRows: number;
      /**
       * The key that an `INSERT` generated.
       *
       * - PostgreSQL: `null`. Use `RETURNING`.
       * - MySQL: the first `AUTO_INCREMENT` value of the statement, `0` if
       *   there is none. Above `Number.MAX_SAFE_INTEGER` it is a string, or a
       *   `BigInt` with `bigint: true`.
       * - SQLite: the `rowid` of the last inserted row, also after a statement
       *   that inserts nothing. `null` for a statement that only reads. A
       *   `BigInt` with `safeIntegers: true` or `bigint: true`.
       */
      lastInsertRowid: number | bigint | string | null;
      /**
       * The kind of statement. PostgreSQL: the command tag, such as
       * `"INSERT"` or `"CREATE TABLE"`. SQLite: the first keyword. MySQL:
       * `null`, because the protocol does not report it.
       */
      command: string | null;
      /**
       * The columns of the result, also when it has no rows and with
       * `.values()` or `.raw()`. Empty for a statement that returns no rows,
       * such as a plain `INSERT`. `null` on SQLite.
       */
      columns: ResultColumn[] | null;
      /**
       * The text, the parameter types and the columns of the statement.
       * `null` on SQLite.
       */
      statement: ResultStatement | null;
    }

    /**
     * A pending SQL query. Extends `Promise`, so it can be awaited, and adds
     * methods to control how it runs. The array it resolves to also has
     * {@link ResultMetadata}.
     *
     * A query is lazy. It starts in the call to `then()`, `catch()`,
     * `finally()` or {@link execute}, and `await` calls `then()`.
     *
     * What `then()` and `catch()` return is a promise like any other: when it
     * rejects with nothing to handle the rejection, that is reported as an
     * unhandled rejection. So is an error that a `finally()` callback throws.
     *
     * The failure of a query that was only started, with `execute()` or
     * `finally()`, is not reported once it has a connection, nor when
     * `close({ timeout: 0 })` closes the pool while it waits for one, when it
     * was cancelled before it started, or when its reservation, transaction or
     * savepoint has ended. After `execute()`, a failure to connect, a pool that
     * was already closed, a `cancel()` or the end of the time of
     * `close({ timeout })`, with a timeout above 0, while it waits for a
     * connection, and a query that cannot be built are reported. So is the
     * failure of a query that SQLite runs outside a transaction.
     *
     * Bun reads the parameters when it sends the query. Leave a `Buffer`,
     * `TypedArray`, `Date` or object that you passed alone until the query
     * settles.
     */
    interface Query<T> extends Promise<T & ResultMetadata> {
      /**
       * True while a connection runs the query
       */
      active: boolean;

      /**
       * True after {@link cancel} was called
       */
      cancelled: boolean;

      /**
       * Cancels the query.
       *
       * A query that Bun has not sent yet never runs. It rejects with
       * `ERR_POSTGRES_QUERY_CANCELLED` (or the `MYSQL` / `SQLITE` code).
       *
       * PostgreSQL: Bun asks the server to stop a running query, on a second
       * connection. The query rejects with the server's error, `errno`
       * `"57014"`, or resolves if it ends first. A query that Bun sent behind
       * another one, or that has another one sent behind it, rejects with
       * `ERR_POSTGRES_QUERY_CANCELLED` and a `hint`, because the server may
       * still run it.
       *
       * MySQL: a query that Bun has sent runs to the end and settles with its
       * result.
       */
      cancel(): Query<T>;

      /**
       * Executes the query as a simple query. Parameters are not allowed, but
       * the query can contain multiple commands separated by semicolons.
       */
      simple(): Query<T>;

      /**
       * PostgreSQL only. Starts a `COPY ... TO STDOUT` query and returns the
       * bytes that the server sends, in the format that the statement names.
       * A chunk can end in the middle of a row.
       *
       * Call it before the query starts. The query takes no parameters, and
       * resolves with the row count in `count` when the server has finished.
       * A failure reaches the stream, so the query needs no handler of its own.
       *
       * @example
       * ```ts
       * await Bun.write("users.csv", new Response(sql`COPY users TO STDOUT (FORMAT csv)`.readable()));
       * ```
       */
      readable(): ReadableStream<Uint8Array<ArrayBuffer>>;

      /**
       * PostgreSQL only. Starts a `COPY ... FROM STDIN` query and returns a
       * stream that takes the bytes for the server, in the format that the
       * statement names.
       *
       * `close()` resolves when the server has stored the rows, and rejects
       * with the server's error. `abort()` stores nothing. The connection runs
       * nothing else until then, so always close or abort the stream. Bun
       * aborts a stream that is still open when its transaction, savepoint or
       * reservation ends.
       *
       * Call it before the query starts. The query takes no parameters, and
       * resolves with the row count in `count`.
       *
       * @example
       * ```ts
       * await Bun.file("users.csv").stream().pipeTo(sql`COPY users FROM STDIN (FORMAT csv)`.writable());
       * ```
       */
      writable(): WritableStream<string | NodeJS.TypedArray | DataView | ArrayBufferLike>;

      /**
       * Starts executing the query. Queries are lazy: they only run when
       * awaited or executed with this method.
       */
      execute(): Query<T>;

      /**
       * Returns rows as arrays of `Buffer` objects instead of objects.
       *
       * PostgreSQL and MySQL: the bytes the server sent. On PostgreSQL a
       * prepared query gets `bool`, `int4`, `float4`, `float8`, `numeric`,
       * `bytea`, `time`, `timestamp`, `timestamptz`, `int4[]` and `float4[]` in
       * binary and every other type as text; all types are text on the first run
       * of a query without parameters, with `.simple()` and with
       * `prepare: false`. On MySQL a prepared query is binary. SQLite:
       * `Uint8Array` objects.
       *
       * Call it before the query starts. After that, SQLite ignores it, and on
       * PostgreSQL some types can arrive in the other format.
       */
      raw(): Query<T>;

      /**
       * Returns each row as an array of values, in the same order as the
       * columns in the query.
       *
       * It has no effect after `execute()` on SQLite, which has run the query.
       */
      values(): Query<T>;
    }

    /**
     * Callback function type for transaction contexts
     * @param sql Function to execute SQL queries within the transaction
     */
    type TransactionContextCallback<T> = ContextCallback<T, TransactionSQL>;

    /**
     * Callback function type for savepoint contexts
     * @param sql Function to execute SQL queries within the savepoint
     */
    type SavepointContextCallback<T> = ContextCallback<T, SavepointSQL>;

    /**
     * A parameter or serializable value interpolated into a query.
     *
     * @example
     * ```ts
     * const helper = sql(users, 'id');
     * await sql`insert into users ${helper}`;
     * ```
     */
    interface Helper<T> {
      readonly value: T[];
      readonly columns: (keyof T)[];
    }
  }

  interface SQL extends AsyncDisposable {
    /**
     * Executes a SQL query using template literals
     * @example
     * ```ts
     * const [user] = await sql<Users[]>`select * from users where id = ${1}`;
     * ```
     */
    <T = any>(strings: TemplateStringsArray, ...values: unknown[]): SQL.Query<T>;

    /**
     * Quotes a table, schema or column name as an identifier, to interpolate
     * into a query. It cannot run on its own: awaiting it rejects with
     * `ERR_POSTGRES_NOT_TAGGED_CALL`. To run a string, use {@link SQL.unsafe}.
     *
     * A dot separates schema, table and column, and each part is quoted:
     * `sql("public.users")` is `"public"."users"`. Quoting prevents SQL
     * injection, but it does not limit which object the name reaches. Check a
     * name that comes from a user against a list of allowed names.
     *
     * @example
     * ```ts
     * const users = await sql<User[]>`SELECT * FROM ${sql("public.users")}`;
     * ```
     */
    <T = any>(string: string): SQL.Query<T>;

    /**
     * Helper function for inserting an object into a query
     *
     * @example
     * ```ts
     * // Insert an object
     * const result = await sql`insert into users ${sql(users)} returning *`;
     *
     * // Or pick specific columns
     * const result = await sql`insert into users ${sql(users, "id", "name")} returning *`;
     *
     * // Or a single object
     * const result = await sql`insert into users ${sql(user)} returning *`;
     * ```
     */
    <T extends { [Key in PropertyKey]: unknown }>(obj: T | T[] | readonly T[]): SQL.Helper<T>; // Contributor note: This is the same as the signature below with the exception of the columns and the Pick<T, Keys>

    /**
     * Helper function for inserting an object into a query, supporting specific columns
     *
     * @example
     * ```ts
     * // Insert an object
     * const result = await sql`insert into users ${sql(users)} returning *`;
     *
     * // Or pick specific columns
     * const result = await sql`insert into users ${sql(users, "id", "name")} returning *`;
     *
     * // Or a single object
     * const result = await sql`insert into users ${sql(user)} returning *`;
     * ```
     */
    <T extends { [Key in PropertyKey]: unknown }, Keys extends keyof T = keyof T>(
      obj: T | T[] | readonly T[],
      ...columns: readonly Keys[]
    ): SQL.Helper<Pick<T, Keys>>; // Contributor note: This is the same as the signature above with the exception of this signature tracking keys

    /**
     * Helper function for inserting any serializable value into a query
     *
     * @example
     * ```ts
     * const result = await sql`SELECT * FROM users WHERE id IN ${sql([1, 2, 3])}`;
     * ```
     */
    // `T & {}` rejects a bare `null`/`undefined` value, which the runtime
    // throws on. An array such as `[null]` stays allowed: it is a valid
    // `WHERE IN` binding and is an object, so it still satisfies `{}`.
    <T>(value: T & {}): SQL.Helper<T>;
  }

  /**
   * SQL client. Manages a connection pool, queries, and transactions.
   *
   * A client is a function: call it as a tagged template to make a query.
   * Every client passes `instanceof SQL`: `new SQL()`, `Bun.sql`, a reserved
   * connection, and the client of a transaction or savepoint callback.
   *
   * `SQL` cannot be subclassed. `new` on a class that extends it throws a
   * `TypeError`. To add behavior, wrap the client.
   */
  class SQL {
    /**
     * Creates a new SQL client instance
     *
     * @param connectionString Database connection string or URL
     *
     * @example
     * ```ts
     * const sql = new SQL("postgres://localhost:5432/mydb");
     * const sql = new SQL(new URL("postgres://localhost:5432/mydb"));
     * ```
     */
    constructor(connectionString: string | URL);

    /**
     * Creates a new SQL client instance with options
     *
     * @param connectionString Database connection string or URL
     * @param options Connection and pool options
     *
     * @example
     * ```ts
     * const sql = new SQL("postgres://localhost:5432/mydb", { idleTimeout: 1000 });
     * ```
     */
    constructor(
      connectionString: string | URL,
      options: Bun.__internal.DistributedOmit<SQL.Options, "url" | "filename">,
    );

    /**
     * Creates a new SQL client instance with options
     *
     * @param options Connection and pool options, including the URL or filename
     *
     * @example
     * ```ts
     * const sql = new SQL({ url: "postgres://localhost:5432/mydb", idleTimeout: 1000 });
     * ```
     */
    constructor(options?: SQL.Options);

    /**
     * The resolved settings of the client, after the URL, the options and the
     * environment are merged.
     *
     * Treat it as output. Timeouts are in milliseconds here, and only the
     * long option names are set (`hostname`, not `host`), so
     * `new SQL(sql.options)` does not make an equal client. `console.log`
     * prints `[REDACTED]` for the password and the TLS key.
     */
    options: Bun.__internal.DistributedMerge<SQL.Options>;

    /**
     * Commits a distributed transaction, also known as a prepared transaction
     * in PostgreSQL or an XA transaction in MySQL
     *
     * @param name Name of the distributed transaction
     *
     * @throws {Error} If the adapter does not support distributed transactions (e.g., SQLite)
     *
     * @example
     * ```ts
     * await sql.commitDistributed("my_distributed_transaction");
     * ```
     */
    commitDistributed(name: string): Promise<void>;

    /**
     * Rolls back a distributed transaction, also known as a prepared
     * transaction in PostgreSQL or an XA transaction in MySQL
     *
     * @param name Name of the distributed transaction
     *
     * @throws {Error} If the adapter does not support distributed transactions (e.g., SQLite)
     *
     * @example
     * ```ts
     * await sql.rollbackDistributed("my_distributed_transaction");
     * ```
     */
    rollbackDistributed(name: string): Promise<void>;

    /**
     * Waits for the database connection to be established. Opens one
     * connection if the pool has none.
     *
     * @example
     * ```ts
     * await sql.connect();
     * ```
     */
    connect(): Promise<SQL>;

    /**
     * Closes every connection of the pool. With `timeout: 0` it closes
     * immediately; with no timeout it waits for all queries to finish first.
     *
     * It waits for the queries that started before the call. When the timeout
     * ends, the queries that still run reject with
     * `ERR_POSTGRES_CONNECTION_CLOSED` or `ERR_MYSQL_CONNECTION_CLOSED`, and so
     * does everything that is started after `close()`.
     *
     * You can call it again. Every call resolves when the pool is closed, and
     * the shortest timeout counts.
     *
     * @param options Optional `timeout` in seconds, an upper bound for the wait
     *
     * @example
     * ```ts
     * await sql.close({ timeout: 1 });
     * ```
     */
    close(options?: { timeout?: number }): Promise<void>;

    /**
     * Closes the database connection. Alias of {@link SQL.close}.
     *
     * @param options Optional `timeout` in seconds
     *
     * @example
     * ```ts
     * await sql.end({ timeout: 1 });
     * ```
     */
    end(options?: { timeout?: number }): Promise<void>;

    /**
     * Flushes any pending operations. Does nothing on SQLite, where queries
     * run synchronously.
     *
     * @example
     * ```ts
     * sql.flush();
     * ```
     */
    flush(): void;

    /**
     * Reserves a connection from the pool and returns a client that wraps
     * that single connection. Use it to run queries on an isolated
     * connection.
     *
     * Calling `reserve()` on a reserved client returns a new reserved
     * connection, not the same one (behavior matches the `postgres` package).
     *
     * @param options `signal` aborts the reservation while it is still
     * waiting for a connection; the returned promise rejects with
     * `signal.reason` and no connection is taken from the pool. Aborting
     * after the promise resolved has no effect: the caller owns the
     * connection and must `release()` it.
     *
     * Rejects if the adapter does not support connection pooling (SQLite).
     *
     * @example
     * ```ts
     * const reserved = await sql.reserve();
     * await reserved`select * from users`;
     * await reserved.release();
     *
     * // In production, release in a finally block
     * const reserved = await sql.reserve();
     * try {
     *   // ... queries
     * } finally {
     *   await reserved.release();
     * }
     *
     * // Bun supports Symbol.dispose and Symbol.asyncDispose,
     * // so `using` releases the connection at the end of the scope
     * using reserved = await sql.reserve()
     * await reserved`select * from users`
     *
     * // Give up on the reservation if no connection frees up in time
     * const reserved = await sql.reserve({ signal: AbortSignal.timeout(5000) });
     * ```
     */
    reserve(options?: { signal?: AbortSignal }): Promise<ReservedSQL>;

    /**
     * Creates a PostgreSQL array parameter. `null` elements are SQL `NULL`, and
     * nested arrays make a multi-dimensional array. Throws on MySQL and SQLite.
     *
     * @param values Array values to bind
     * @param typeNameOrTypeID Element type name, or the OID of the array type.
     * Bun casts the parameter to it: `$1::INT[]`. When omitted, Bun adds no
     * cast and the server infers the type from the column, the compared value
     * or a cast in the query. Pass it when the query gives no context: a bare
     * `SELECT ${sql.array([1])}` returns the text `{"1"}`. Pass `"JSON"` or
     * `"JSONB"` to encode each element as JSON: there `null` is the JSON value
     * `null`, `undefined` is SQL `NULL`, and `sql.json([1, 2])` stores a JSON
     * array as one element.
     * @returns The array parameter, ready to interpolate into a query
     *
     * @example
     * ```ts
     * const array = sql.array([1, 2, 3], "INT");
     * await sql`CREATE TABLE users_posts (user_id INT, posts_id INT[])`;
     * await sql`INSERT INTO users_posts (user_id, posts_id) VALUES (${user.id}, ${array})`;
     *
     * // the server infers the type from the compared column
     * await sql`SELECT * FROM users WHERE id = ANY(${sql.array([1, 2, 3])})`;
     * ```
     */
    array(values: any[] | NodeJS.TypedArray, typeNameOrTypeID?: number | ArrayType): SQLArrayParameter;

    /**
     * Returns a parameter that stores `value` as JSON, to interpolate into a
     * query. It works on every adapter.
     *
     * Bun sends an object or an array as JSON by itself, and PostgreSQL stores
     * a string in a `json` or `jsonb` column as a JSON string. Use `sql.json`
     * to store a JSON number, boolean or `null`, to store an object or an
     * array on SQLite, and to store a JSON string where Bun sends a string as
     * it is: MySQL, MariaDB, SQLite, and PostgreSQL with `prepare: false`.
     *
     * @example
     * ```ts
     * await sql`INSERT INTO settings (data) VALUES (${sql.json(42)})`; // 42
     * await sql`INSERT INTO settings (data) VALUES (${sql.json(null)})`; // JSON null, not SQL NULL
     * await sql`INSERT INTO settings (data) VALUES (${sql.json("dark")})`; // "dark"
     * ```
     */
    json(value: unknown): SQLJSONParameter | string | undefined;

    /**
     * Begins a new transaction.
     *
     * Reserves a connection for the transaction and passes a scoped `sql`
     * instance to the callback. `sql.begin` resolves with the callback's
     * return value. `BEGIN` is sent automatically, and if anything fails,
     * `ROLLBACK` is sent so the connection can be released and execution can
     * continue.
     * @example
     * ```ts
     * const [user, account] = await sql.begin(async sql => {
     *   const [user] = await sql`
     *     insert into users (
     *       name
     *     ) values (
     *       'Murray'
     *     )
     *     returning *
     *   `
     *   const [account] = await sql`
     *     insert into accounts (
     *       user_id
     *     ) values (
     *       ${ user.user_id }
     *     )
     *     returning *
     *   `
     *   return [user, account]
     * })
     * ```
     */
    begin<const T>(fn: SQL.TransactionContextCallback<T>): Promise<SQL.ContextCallbackResult<T>>;

    /**
     * Begins a new transaction with options.
     *
     * Reserves a connection for the transaction and passes a scoped `sql`
     * instance to the callback. `sql.begin` resolves with the callback's
     * return value. `BEGIN` is sent with the given options, and if anything
     * fails, `ROLLBACK` is sent so the connection can be released and
     * execution can continue.
     * @example
     * ```ts
     * const [user, account] = await sql.begin("read write", async sql => {
     *   const [user] = await sql`
     *     insert into users (
     *       name
     *     ) values (
     *       'Murray'
     *     )
     *     returning *
     *   `
     *   const [account] = await sql`
     *     insert into accounts (
     *       user_id
     *     ) values (
     *       ${ user.user_id }
     *     )
     *     returning *
     *   `
     *   return [user, account]
     * })
     * ```
     */
    begin<const T>(options: string, fn: SQL.TransactionContextCallback<T>): Promise<SQL.ContextCallbackResult<T>>;

    /**
     * Begins a new transaction. Alias of {@link begin}.
     *
     * Reserves a connection for the transaction and passes a scoped `sql`
     * instance to the callback. `sql.transaction` resolves with the
     * callback's return value. `BEGIN` is sent automatically, and if
     * anything fails, `ROLLBACK` is sent so the connection can be released
     * and execution can continue.
     * @alias begin
     * @example
     * ```ts
     * const [user, account] = await sql.transaction(async sql => {
     *   const [user] = await sql`
     *     insert into users (
     *       name
     *     ) values (
     *       'Murray'
     *     )
     *     returning *
     *   `
     *   const [account] = await sql`
     *     insert into accounts (
     *       user_id
     *     ) values (
     *       ${ user.user_id }
     *     )
     *     returning *
     *   `
     *   return [user, account]
     * })
     * ```
     */
    transaction<const T>(fn: SQL.TransactionContextCallback<T>): Promise<SQL.ContextCallbackResult<T>>;

    /**
     * Begins a new transaction with options. Alias of {@link begin}.
     *
     * Reserves a connection for the transaction and passes a scoped `sql`
     * instance to the callback. `sql.transaction` resolves with the
     * callback's return value. `BEGIN` is sent with the given options, and
     * if anything fails, `ROLLBACK` is sent so the connection can be
     * released and execution can continue.
     *
     * @alias {@link begin}
     *
     * @example
     * ```ts
     * const [user, account] = await sql.transaction("read write", async sql => {
     *   const [user] = await sql`
     *     insert into users (
     *       name
     *     ) values (
     *       'Murray'
     *     )
     *     returning *
     *   `
     *   const [account] = await sql`
     *     insert into accounts (
     *       user_id
     *     ) values (
     *       ${ user.user_id }
     *     )
     *     returning *
     *   `
     *   return [user, account]
     * });
     * ```
     */
    transaction<const T>(options: string, fn: SQL.TransactionContextCallback<T>): Promise<SQL.ContextCallbackResult<T>>;

    /**
     * Begins a distributed transaction, also known as Two-Phase Commit. In
     * phase 1 the coordinator prepares each node, making sure its data is
     * written and ready to commit; in phase 2 the nodes commit or roll back
     * based on the coordinator's decision, ensuring durability and releasing
     * locks.
     *
     * `beginDistributed` rolls back automatically if an exception is not
     * caught; otherwise you commit or roll back later with
     * {@link commitDistributed} or {@link rollbackDistributed}.
     *
     * In PostgreSQL and MySQL, distributed transactions persist beyond the
     * original session, so privileged users or coordinators can commit or
     * roll them back later, which supports recovery and administrative
     * tasks. PostgreSQL implements them with `PREPARE TRANSACTION`; MySQL
     * uses XA Transactions. MSSQL also supports distributed/XA transactions,
     * but ties them to the original session, the DTC coordinator, and the
     * specific connection: they are committed or rolled back under the same
     * rules as regular transactions, with no manual intervention from other
     * sessions, and are used to coordinate transactions across Linked
     * Servers.
     *
     * @throws {Error} If the adapter does not support distributed transactions (e.g., SQLite)
     *
     * @example
     * ```ts
     * await sql.beginDistributed("numbers", async sql => {
     *   await sql`create table if not exists numbers (a int)`;
     *   await sql`insert into numbers values(1)`;
     * });
     * // later you can call
     * await sql.commitDistributed("numbers");
     * // or await sql.rollbackDistributed("numbers");
     * ```
     */
    beginDistributed<const T>(
      name: string,
      fn: SQL.TransactionContextCallback<T>,
    ): Promise<SQL.ContextCallbackResult<T>>;

    /** Begins a distributed transaction. Alias of {@link beginDistributed}.
     * @alias {@link beginDistributed}
     */
    distributed<const T>(name: string, fn: SQL.TransactionContextCallback<T>): Promise<SQL.ContextCallbackResult<T>>;

    /**
     * Executes any query string as-is. This can lead to SQL injection if the
     * string contains untrusted input.
     *
     * The string takes the database's own placeholders: `$1` on PostgreSQL, `?`
     * on MySQL, either on SQLite. Pass `values` as an array, which Bun copies
     * in the call. Without `values`, the string can hold several statements.
     *
     * `sql.unsafe` can be nested inside a safe `sql` expression, for example
     * when only part of the query is unsafe. Bun adds the nested text as
     * written. On PostgreSQL, a nested `sql.unsafe` that has `values` cannot
     * follow other parameters, because `$1` in its text is the first parameter
     * of the whole query: such a query rejects with a `SyntaxError`.
     *
     * With the SQLite adapter, `values` may also be an object of named
     * parameters (`:name`, `$name`, or `@name` placeholders). A key works with
     * or without the prefix. This form does not work in a nested `sql.unsafe`.
     * @example
     * ```ts
     * const result = await sql.unsafe(`select ${danger} from users where id = ${dragons}`)
     * const row = await sql.unsafe("select * from users where id = :id", { id: 1 })
     * ```
     */
    unsafe<T = any>(string: string, values?: any[] | Record<string, any>): SQL.Query<T>;

    /**
     * Reads a file and runs its contents as a query. The query is lazy: Bun
     * reads the file when the query starts.
     * Pass `values` as an array if the file uses positional parameters (`$1` on
     * PostgreSQL, `?` on MySQL).
     * With the SQLite adapter, `values` may also be an object of named
     * parameters (`:name`, `$name`, or `@name` placeholders). A key works with
     * or without the prefix.
     * @example
     * ```ts
     * const result = await sql.file("query.sql", [1, 2, 3]);
     * ```
     */
    file<T = any>(filename: string, values?: any[] | Record<string, any>): SQL.Query<T>;

    /**
     * Subscribe to a PostgreSQL `LISTEN` channel. Resolves once the server has
     * acknowledged the subscription, with a handle that removes it again.
     *
     * Every call is its own registration: several on one channel share a
     * single server-side subscription and each receives every notification.
     * All of them share one dedicated connection, opened by the first
     * `listen()` and closed when the last registration is removed. If it
     * drops, it is reconnected with exponential backoff and every channel is
     * re-subscribed; `onlisten` runs again each time.
     *
     * A throwing `onnotify` or `onlisten` is reported as an uncaught exception.
     *
     * @param channel - Channel name, quoted for you; at most 63 bytes, the
     * PostgreSQL identifier limit
     * @param onnotify - Receives each notification's payload
     * @param onlisten - Runs once the `LISTEN` is acknowledged, initially and
     * after every reconnect
     *
     * @example
     * ```ts
     * const subscription = await sql.listen("events", payload => console.log(payload));
     * await sql.notify("events", "hello");
     * await subscription.unlisten();
     * ```
     *
     * @example
     * ```ts
     * await using subscription = await sql.listen("events", handle);
     * ```
     */
    listen(
      channel: string,
      onnotify: (payload: string) => void,
      onlisten?: () => void,
    ): Promise<SQL.ListenSubscription>;

    /**
     * Send a PostgreSQL `NOTIFY` via `pg_notify`. Runs as a normal query on
     * this handle, so on a `sql.begin()` transaction it is delivered on commit
     * and discarded on rollback. Omitting `payload` sends an empty one, like a
     * bare `NOTIFY channel`.
     *
     * @example
     * ```ts
     * await sql.notify("events", JSON.stringify({ id: 1 }));
     * await sql.notify("cache-invalidated");
     * ```
     */
    notify(channel: string, payload?: string): Promise<void>;
  }

  /**
   * The default SQL client, configured from environment variables such as
   * `DATABASE_URL`
   */
  const sql: SQL;

  /**
   * SQL client for PostgreSQL
   *
   * @deprecated Prefer {@link Bun.sql}
   */
  const postgres: SQL;

  /**
   * The client passed to {@link TransactionSQL.savepoint} callbacks; queries
   * run within that savepoint.
   *
   * It is a client of its own, not the client of the transaction, and it ends
   * with the savepoint. A query on it that starts later rejects with
   * `ERR_POSTGRES_INVALID_TRANSACTION_STATE` (or the `MYSQL` / `SQLITE` code).
   * For a savepoint inside a savepoint, call `savepoint()` on it.
   */
  interface SavepointSQL extends TransactionSQL {}
}
