import type * as BunSQLite from "bun:sqlite";

declare module "bun" {
  /**
   * A connection reserved from the pool with {@link SQL.reserve}. Call
   * {@link release} to return it to the pool.
   */
  interface ReservedSQL extends SQL, Disposable {
    /**
     * Releases the client back to the connection pool
     */
    release(): void;
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

  /**
   * An array parameter created by {@link SQL.array}
   */
  interface SQLArrayParameter {
    /**
     * The array values, serialized into a single string
     */
    serializedValues: string;
    /**
     * The element type of the array, for example `"INT"`
     */
    arrayType: ArrayType;
  }

  /**
   * The client passed to transaction callbacks ({@link SQL.begin},
   * {@link SQL.transaction}). Extends {@link SQL} with savepoints.
   */
  interface TransactionSQL extends SQL {
    /**
     * Creates a savepoint within the current transaction
     */
    savepoint<T>(name: string, fn: SQL.SavepointContextCallback<T>): Promise<T>;
    savepoint<T>(fn: SQL.SavepointContextCallback<T>): Promise<T>;

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
      public readonly code: string;
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
      public readonly code: string;
      public readonly errno?: number | undefined;
      public readonly sqlState?: string | undefined;
      constructor(message: string, options: { code: string; errno: number | undefined; sqlState: string | undefined });
    }

    class SQLiteError extends SQLError {
      public readonly code: string;
      public readonly errno: number;
      public readonly byteOffset?: number | undefined;

      constructor(message: string, options: { code: string; errno: number; byteOffset?: number | undefined });
    }

    type AwaitPromisesArray<T extends Array<PromiseLike<any>>> = {
      [K in keyof T]: Awaited<T[K]>;
    };

    type ContextCallbackResult<T> = T extends Array<PromiseLike<any>> ? AwaitPromisesArray<T> : Awaited<T>;
    type ContextCallback<T, SQL> = (sql: SQL) => Bun.MaybePromise<T>;

    interface SQLiteOptions extends BunSQLite.DatabaseOptions {
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
       * @default ":memory:"
       */
      filename?: URL | ":memory:" | (string & {}) | undefined;

      /**
       * SQLite: called once opening the database has been attempted, with
       * `null` when it opened or with the `Error` that prevented it from
       * opening (for example `SQLITE_CANTOPEN`).
       */
      onconnect?: ((err: Error | null) => void) | undefined;

      /**
       * SQLite: called when the database is closed with {@link SQL.close}.
       * Passes an `Error` (message `"Connection closed"`) rather than `null`,
       * even though the close was requested.
       */
      onclose?: ((err: Error | null) => void) | undefined;
    }

    interface PostgresOrMySQLOptions {
      /**
       * Connection URL, for example `postgres://user:pass@localhost:5432/mydb`
       */
      url?: URL | string | undefined;

      /**
       * Database server hostname
       * @deprecated Prefer {@link hostname}
       * @default "localhost"
       */
      host?: string | undefined;

      /**
       * Database server hostname
       * @default "localhost"
       */
      hostname?: string | undefined;

      /**
       * Database server port number
       * @default 5432
       */
      port?: number | string | undefined;

      /**
       * Database user for authentication
       * @default "postgres"
       */
      username?: string | undefined;

      /**
       * Database user for authentication (alias for username)
       * @deprecated Prefer {@link username}
       * @default "postgres"
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
       * Name of the database to connect to
       * @default The username value
       */
      database?: string | undefined;

      /**
       * Name of the database to connect to (alias for database)
       * @deprecated Prefer {@link database}
       * @default The username value
       */
      db?: string | undefined;

      /**
       * Database adapter/driver to use
       * @default "postgres"
       */
      adapter?: "postgres" | "mysql" | "mariadb";

      /**
       * Maximum time in seconds a connection can sit idle before it is closed
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
       * Maximum time in seconds to wait when establishing a connection
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
       * Maximum lifetime in seconds of a connection
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
       * @default false
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
       * Unix domain socket path for connection
       * @default undefined
       */
      path?: string | undefined;

      /**
       * PostgreSQL and MySQL: called once for each connection the pool
       * establishes, always with `null`. A connection attempt that fails is
       * reported to {@link onclose} instead; `onconnect` is not called for it.
       */
      onconnect?: ((err: Error | null) => void) | undefined;

      /**
       * PostgreSQL and MySQL: called once for each pooled connection that
       * closes or fails to connect, with the `Error` describing why. Closing
       * on purpose also passes an error rather than `null`: {@link SQL.close}
       * passes `ERR_POSTGRES_CONNECTION_CLOSED` / `ERR_MYSQL_CONNECTION_CLOSED`,
       * and {@link idleTimeout} passes `ERR_POSTGRES_IDLE_TIMEOUT` /
       * `ERR_MYSQL_IDLE_TIMEOUT`. A failed connection attempt passes its
       * error, for example `ERR_POSTGRES_CONNECTION_REFUSED` or the server's
       * authentication error.
       */
      onclose?: ((err: Error | null) => void) | undefined;

      /**
       * Postgres client runtime configuration options
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
       * Return values outside the i32 range as `BigInt`. By default they are
       * returned as strings.
       * @default false
       */
      bigint?: boolean | undefined;

      /**
       * Automatic creation of prepared statements
       * @default true
       */
      prepare?: boolean | undefined;

      /**
       * MySQL only. Allow the client to request the server's RSA public key
       * during `caching_sha2_password` / `sha256_password` authentication when
       * the connection is not protected by TLS. Disabled by default because a
       * network attacker can substitute their own key and recover the
       * plaintext password. Enable only for trusted local connections, or use
       * TLS instead.
       * @default false
       */
      allowPublicKeyRetrieval?: boolean | undefined;
    }

    /**
     * Configuration options for SQL client connection and behavior
     *
     * @example
     * ```ts
     * const config: Bun.SQL.Options = {
     *   host: 'localhost',
     *   port: 5432,
     *   user: 'dbuser',
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
     * A pending SQL query. Extends `Promise`, so it can be awaited, and adds
     * methods to control how it runs.
     */
    interface Query<T> extends Promise<T> {
      /**
       * True while the query is executing
       */
      active: boolean;

      /**
       * True if the query has been cancelled
       */
      cancelled: boolean;

      /**
       * Cancels the executing query
       */
      cancel(): Query<T>;

      /**
       * Executes the query as a simple query. Parameters are not allowed, but
       * the query can contain multiple commands separated by semicolons.
       */
      simple(): Query<T>;

      /**
       * Starts executing the query. Queries are lazy: they only run when
       * awaited or executed with this method.
       */
      execute(): Query<T>;

      /**
       * Returns rows as arrays of `Buffer` objects instead of objects
       */
      raw(): Query<T>;

      /**
       * Returns each row as an array of values, in the same order as the
       * columns in the query
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
     * Executes a SQL query from a string
     *
     * @example
     * ```ts
     * const users = await sql<User[]>("SELECT * FROM users");
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
     * Current client options
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

    /** Waits for the database connection to be established
     *
     * @example
     * ```ts
     * await sql.connect();
     * ```
     */
    connect(): Promise<SQL>;

    /**
     * Closes the database connection. With `timeout: 0` it closes
     * immediately; with no timeout it waits for all queries to finish first.
     *
     * @param options Optional `timeout` in seconds
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
     * Flushes any pending operations
     *
     * @throws {Error} If the adapter does not support flushing (e.g., SQLite)
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
     * @throws {Error} If the adapter does not support connection pooling (e.g., SQLite)
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
     * Creates a SQL array parameter
     * @param values Array values to bind
     * @param typeNameOrTypeID Element type name or type ID; defaults to JSON when omitted
     * @returns The array parameter, ready to interpolate into a query
     *
     * @example
     * ```ts
     * const array = sql.array([1, 2, 3], "INT");
     * await sql`CREATE TABLE users_posts (user_id INT, posts_id INT[])`;
     * await sql`INSERT INTO users_posts (user_id, posts_id) VALUES (${user.id}, ${array})`;
     * ```
     */
    array(values: any[], typeNameOrTypeID?: number | ArrayType): SQLArrayParameter;

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
     * `sql.unsafe` can be nested inside a safe `sql` expression, for example
     * when only part of the query is unsafe.
     *
     * With the SQLite adapter, `values` may also be an object of named
     * parameters (`:name`, `$name`, or `@name` placeholders). Object keys
     * keep the prefix unless the connection sets `strict: true`.
     * @example
     * ```ts
     * const result = await sql.unsafe(`select ${danger} from users where id = ${dragons}`)
     * const row = await sql.unsafe("select * from users where id = :id", { ":id": 1 })
     * ```
     */
    unsafe<T = any>(string: string, values?: any[] | Record<string, any>): SQL.Query<T>;

    /**
     * Reads a file and runs its contents as a query.
     * Pass `values` if the file uses positional parameters (`$1`, `$2`, ...).
     * With the SQLite adapter, `values` may also be an object of named
     * parameters (`:name`, `$name`, or `@name` placeholders); keys keep the
     * prefix unless the connection sets `strict: true`.
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
   * run within that savepoint
   */
  interface SavepointSQL extends SQL {}
}
