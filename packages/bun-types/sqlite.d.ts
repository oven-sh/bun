/**
 * Fast SQLite3 driver for Bun.js
 * @since v0.0.83
 *
 * @example
 * ```ts
 * import { Database } from 'bun:sqlite';
 *
 * var db = new Database('app.db');
 * db.query('SELECT * FROM users WHERE name = ?').all('John');
 * // => [{ id: 1, name: 'John' }]
 * ```
 *
 * The following types can be used when binding parameters:
 *
 * | JavaScript type | SQLite type |
 * | -------------- | ----------- |
 * | `string` | `TEXT` |
 * | `number` | `INTEGER` or `DECIMAL` |
 * | `boolean` | `INTEGER` (1 or 0) |
 * | `Uint8Array` | `BLOB` |
 * | `Buffer` | `BLOB` |
 * | `bigint` | `INTEGER` |
 * | `null` | `NULL` |
 */
declare module "bun:sqlite" {
  export class Database {
    /**
     * Open or create a SQLite3 database
     *
     * @param filename The filename of the database to open. Pass an empty string (`""`) or `":memory:"` or undefined for an in-memory database.
     * @param options defaults to `{readwrite: true, create: true}`. If a number, then it's treated as `SQLITE_OPEN_*` constant flags.
     *
     * @example
     *
     * ```ts
     * const db = new Database("mydb.sqlite");
     * db.run("CREATE TABLE foo (bar TEXT)");
     * db.run("INSERT INTO foo VALUES (?)", "baz");
     * console.log(db.query("SELECT * FROM foo").all());
     * ```
     *
     * @example
     *
     * Open an in-memory database
     *
     * ```ts
     * const db = new Database(":memory:");
     * db.run("CREATE TABLE foo (bar TEXT)");
     * db.run("INSERT INTO foo VALUES (?)", "hiiiiii");
     * console.log(db.query("SELECT * FROM foo").all());
     * ```
     *
     * @example
     *
     * Open read-only
     *
     * ```ts
     * const db = new Database("mydb.sqlite", {readonly: true});
     * ```
     */
    constructor(
      filename?: string,
      options?:
        | number
        | {
            /**
             * Open the database as read-only (no write operations, no create).
             *
             * Equivalent to {@link constants.SQLITE_OPEN_READONLY}
             */
            readonly?: boolean;
            /**
             * Allow creating a new database
             *
             * Equivalent to {@link constants.SQLITE_OPEN_CREATE}
             */
            create?: boolean;
            /**
             * Open the database as read-write
             *
             * Equivalent to {@link constants.SQLITE_OPEN_READWRITE}
             */
            readwrite?: boolean;
          },
    );

    /**
     * This is an alias of `new Database()`
     *
     * See {@link Database}
     */
    static open(
      filename: string,
      options?:
        | number
        | {
            /**
             * Open the database as read-only (no write operations, no create).
             *
             * Equivalent to {@link constants.SQLITE_OPEN_READONLY}
             */
            readonly?: boolean;
            /**
             * Allow creating a new database
             *
             * Equivalent to {@link constants.SQLITE_OPEN_CREATE}
             */
            create?: boolean;
            /**
             * Open the database as read-write
             *
             * Equivalent to {@link constants.SQLITE_OPEN_READWRITE}
             */
            readwrite?: boolean;
          },
    ): Database;

    /**
     * Execute a SQL query **without returning any results**.
     *
     * This does not cache the query, so if you want to run a query multiple times, you should use {@link prepare} instead.
     *
     * @example
     * ```ts
     * db.run("CREATE TABLE foo (bar TEXT)");
     * db.run("INSERT INTO foo VALUES (?)", "baz");
     * ```
     *
     * Useful for queries like:
     * - `CREATE TABLE`
     * - `INSERT INTO`
     * - `UPDATE`
     * - `DELETE FROM`
     * - `DROP TABLE`
     * - `PRAGMA`
     * - `ATTACH DATABASE`
     * - `DETACH DATABASE`
     * - `REINDEX`
     * - `VACUUM`
     * - `EXPLAIN ANALYZE`
     * - `CREATE INDEX`
     * - `CREATE TRIGGER`
     * - `CREATE VIEW`
     * - `CREATE VIRTUAL TABLE`
     * - `CREATE TEMPORARY TABLE`
     *
     * @param sql The SQL query to run
     *
     * @param bindings Optional bindings for the query
     *
     * @returns `Database` instance
     *
     * Under the hood, this calls `sqlite3_prepare_v3` followed by `sqlite3_step` and `sqlite3_finalize`.
     *
     *  * The following types can be used when binding parameters:
     *
     * | JavaScript type | SQLite type |
     * | -------------- | ----------- |
     * | `string` | `TEXT` |
     * | `number` | `INTEGER` or `DECIMAL` |
     * | `boolean` | `INTEGER` (1 or 0) |
     * | `Uint8Array` | `BLOB` |
     * | `Buffer` | `BLOB` |
     * | `bigint` | `INTEGER` |
     * | `null` | `NULL` |
     */
    run<ParamsType = SQLQueryBindings>(
      sqlQuery: string,
      ...bindings: ParamsType[]
    ): void;
    /** 
        This is an alias of {@link Database.prototype.run}
     */
    exec<ParamsType = SQLQueryBindings>(
      sqlQuery: string,
      ...bindings: ParamsType[]
    ): void;

    /**
     * Compile a SQL query and return a {@link Statement} object. This is the
     * same as {@link prepare} except that it caches the compiled query.
     *
     * This **does not execute** the query, but instead prepares it for later
     * execution and caches the compiled query if possible.
     *
     * @example
     * ```ts
     * // compile the query
     * const stmt = db.query("SELECT * FROM foo WHERE bar = ?");
     * // run the query
     * stmt.all("baz");
     *
     * // run the query again
     * stmt.all();
     * ```
     *
     * @param sql The SQL query to compile
     *
     * @returns `Statment` instance
     *
     * Under the hood, this calls `sqlite3_prepare_v3`.
     *
     */
    query<ParamsType = SQLQueryBindings, ReturnType = any>(
      sqlQuery: string,
    ): Statement<ParamsType, ReturnType>;

    /**
     * Compile a SQL query and return a {@link Statement} object.
     *
     * This does not cache the compiled query and does not execute the query.
     *
     * @example
     * ```ts
     * // compile the query
     * const stmt = db.query("SELECT * FROM foo WHERE bar = ?");
     * // run the query
     * stmt.all("baz");
     * ```
     *
     * @param sql The SQL query to compile
     * @param params Optional bindings for the query
     *
     * @returns `Statment` instance
     *
     * Under the hood, this calls `sqlite3_prepare_v3`.
     *
     */
    prepare<ParamsType = SQLQueryBindings, ReturnType = any>(
      sql: string,
      ...params: ParamsType[]
    ): Statement<ParamsType, ReturnType>;

    /**
     * Is the database in a transaction?
     *
     * @returns `true` if the database is in a transaction, `false` otherwise
     *
     * @example
     * ```ts
     * db.run("CREATE TABLE foo (bar TEXT)");
     * db.run("INSERT INTO foo VALUES (?)", "baz");
     * db.run("BEGIN");
     * db.run("INSERT INTO foo VALUES (?)", "qux");
     * console.log(db.inTransaction());
     * ```
     */
    get inTransaction(): boolean;

    /**
     * Close the database connection.
     *
     * It is safe to call this method multiple times. If the database is already
     * closed, this is a no-op. Running queries after the database has been
     * closed will throw an error.
     *
     * @example
     * ```ts
     * db.close();
     * ```
     * This is called automatically when the database instance is garbage collected.
     *
     * Internally, this calls `sqlite3_close_v2`.
     */
    close(): void;

    /**
     * The filename passed when `new Database()` was called
     * @example
     * ```ts
     * const db = new Database("mydb.sqlite");
     * console.log(db.filename);
     * // => "mydb.sqlite"
     * ```
     */
    readonly filename: string;

    /**
     * The underlying `sqlite3` database handle
     *
     * In native code, this is not a file descriptor, but an index into an array of database handles
     */
    readonly handle: number;

    /**
     * Load a SQLite3 extension
     *
     * macOS requires a custom SQLite3 library to be linked because the Apple build of SQLite for macOS disables loading extensions. See {@link Database.setCustomSQLite}
     *
     * Bun chooses the Apple build of SQLite on macOS because it brings a ~50% performance improvement.
     *
     * @param extension name/path of the extension to load
     * @param entryPoint optional entry point of the extension
     */
    loadExtension(extension: string, entryPoint?: string): void;

    /**
     * Change the dynamic library path to SQLite
     *
     * @note macOS-only
     *
     * This only works before SQLite is loaded, so
     * that's before you call `new Database()`.
     *
     * It can only be run once because this will load
     * the SQLite library into the process.
     *
     * @param path The path to the SQLite library
     *
     */
    static setCustomSQLite(path: string): boolean;

    /**
     * Creates a function that always runs inside a transaction. When the
     * function is invoked, it will begin a new transaction. When the function
     * returns, the transaction will be committed. If an exception is thrown,
     * the transaction will be rolled back (and the exception will propagate as
     * usual).
     *
     * @param insideTransaction The callback which runs inside a transaction
     *
     * @example
     * ```ts
     * // setup
     * import { Database } from "bun:sqlite";
     * const db = Database.open(":memory:");
     * db.exec(
     *   "CREATE TABLE cats (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, age INTEGER)"
     * );
     *
     * const insert = db.prepare("INSERT INTO cats (name, age) VALUES ($name, $age)");
     * const insertMany = db.transaction((cats) => {
     *   for (const cat of cats) insert.run(cat);
     * });
     *
     * insertMany([
     *   { $name: "Joey", $age: 2 },
     *   { $name: "Sally", $age: 4 },
     *   { $name: "Junior", $age: 1 },
     * ]);
     * ```
     */
    transaction(insideTransaction: (...args: any) => void): CallableFunction & {
      /**
       * uses "BEGIN DEFERRED"
       */
      deferred: (...args: any) => void;
      /**
       * uses "BEGIN IMMEDIATE"
       */
      immediate: (...args: any) => void;
      /**
       * uses "BEGIN EXCLUSIVE"
       */
      exclusive: (...args: any) => void;
    };
  }

  /**
   * A prepared statement.
   *
   * This is returned by {@link Database.prepare} and {@link Database.query}.
   *
   * @example
   * ```ts
   * const stmt = db.prepare("SELECT * FROM foo WHERE bar = ?");
   * stmt.all("baz");
   * // => [{bar: "baz"}]
   * ```
   *
   * @example
   * ```ts
   * const stmt = db.prepare("SELECT * FROM foo WHERE bar = ?");
   * stmt.get("baz");
   * // => {bar: "baz"}
   * ```
   *
   * @example
   * ```ts
   * const stmt = db.prepare("SELECT * FROM foo WHERE bar = ?");
   * stmt.run("baz");
   * // => undefined
   * ```
   */
  export class Statement<ParamsType = SQLQueryBindings, ReturnType = any> {
    /**
     * Creates a new prepared statement from native code.
     *
     * This is used internally by the {@link Database} class. Probably you don't need to call this yourself.
     */
    constructor(nativeHandle: any);

    /**
     * Execute the prepared statement and return all results as objects.
     *
     * @param params optional values to bind to the statement. If omitted, the statement is run with the last bound values or no parameters if there are none.
     *
     * @example
     * ```ts
     * const stmt = db.prepare("SELECT * FROM foo WHERE bar = ?");
     *
     * stmt.all("baz");
     * // => [{bar: "baz"}]
     *
     * stmt.all();
     * // => [{bar: "baz"}]
     *
     * stmt.all("foo");
     * // => [{bar: "foo"}]
     * ```
     */
    all(...params: ParamsType[]): ReturnType[];

    /**
     * Execute the prepared statement and return **the first** result.
     *
     * If no result is returned, this returns `null`.
     *
     * @param params optional values to bind to the statement. If omitted, the statement is run with the last bound values or no parameters if there are none.
     *
     * @example
     * ```ts
     * const stmt = db.prepare("SELECT * FROM foo WHERE bar = ?");
     *
     * stmt.all("baz");
     * // => [{bar: "baz"}]
     *
     * stmt.all();
     * // => [{bar: "baz"}]
     *
     * stmt.all("foo");
     * // => [{bar: "foo"}]
     * ```
     *
     * The following types can be used when binding parameters:
     *
     * | JavaScript type | SQLite type |
     * | -------------- | ----------- |
     * | `string` | `TEXT` |
     * | `number` | `INTEGER` or `DECIMAL` |
     * | `boolean` | `INTEGER` (1 or 0) |
     * | `Uint8Array` | `BLOB` |
     * | `Buffer` | `BLOB` |
     * | `bigint` | `INTEGER` |
     * | `null` | `NULL` |
     *
     */
    get(...params: ParamsType[]): ReturnType | null;

    /**
     * Execute the prepared statement. This returns `undefined`.
     *
     * @param params optional values to bind to the statement. If omitted, the statement is run with the last bound values or no parameters if there are none.
     *
     * @example
     * ```ts
     * const stmt = db.prepare("UPDATE foo SET bar = ?");
     * stmt.run("baz");
     * // => undefined
     *
     * stmt.run();
     * // => undefined
     *
     * stmt.run("foo");
     * // => undefined
     * ```
     *
     * The following types can be used when binding parameters:
     *
     * | JavaScript type | SQLite type |
     * | -------------- | ----------- |
     * | `string` | `TEXT` |
     * | `number` | `INTEGER` or `DECIMAL` |
     * | `boolean` | `INTEGER` (1 or 0) |
     * | `Uint8Array` | `BLOB` |
     * | `Buffer` | `BLOB` |
     * | `bigint` | `INTEGER` |
     * | `null` | `NULL` |
     *
     */
    run(...params: ParamsType[]): void;

    /**
     * Execute the prepared statement and return the results as an array of arrays.
     *
     * This is a little faster than {@link all}.
     *
     * @param params optional values to bind to the statement. If omitted, the statement is run with the last bound values or no parameters if there are none.
     *
     * @example
     * ```ts
     * const stmt = db.prepare("SELECT * FROM foo WHERE bar = ?");
     *
     * stmt.values("baz");
     * // => [['baz']]
     *
     * stmt.values();
     * // => [['baz']]
     *
     * stmt.values("foo");
     * // => [['foo']]
     * ```
     *
     * The following types can be used when binding parameters:
     *
     * | JavaScript type | SQLite type |
     * | -------------- | ----------- |
     * | `string` | `TEXT` |
     * | `number` | `INTEGER` or `DECIMAL` |
     * | `boolean` | `INTEGER` (1 or 0) |
     * | `Uint8Array` | `BLOB` |
     * | `Buffer` | `BLOB` |
     * | `bigint` | `INTEGER` |
     * | `null` | `NULL` |
     *
     */
    values(
      ...params: ParamsType[]
    ): Array<Array<string | bigint | number | boolean | Uint8Array>>;

    /**
     * The names of the columns returned by the prepared statement.
     * @example
     * ```ts
     * const stmt = db.prepare("SELECT bar FROM foo WHERE bar = ?");
     *
     * console.log(stmt.columnNames);
     * // => ["bar"]
     * ```
     */
    readonly columnNames: string[];

    /**
     * The number of parameters expected in the prepared statement.
     * @example
     * ```ts
     * const stmt = db.prepare("SELECT * FROM foo WHERE bar = ?");
     * console.log(stmt.paramsCount);
     * // => 1
     * ```
     * @example
     * ```ts
     * const stmt = db.prepare("SELECT * FROM foo WHERE bar = ? AND baz = ?");
     * console.log(stmt.paramsCount);
     * // => 2
     * ```
     *
     */
    readonly paramsCount: number;

    /**
     * Finalize the prepared statement, freeing the resources used by the
     * statement and preventing it from being executed again.
     *
     * This is called automatically when the prepared statement is garbage collected.
     *
     * It is safe to call this multiple times. Calling this on a finalized
     * statement has no effect.
     *
     * Internally, this calls `sqlite3_finalize`.
     */
    finalize(): void;

    /**
     * Return the expanded SQL string for the prepared statement.
     *
     * Internally, this calls `sqlite3_expanded_sql()` on the underlying `sqlite3_stmt`.
     *
     * @example
     * ```ts
     * const stmt = db.prepare("SELECT * FROM foo WHERE bar = ?", "baz");
     * console.log(stmt.toString());
     * // => "SELECT * FROM foo WHERE bar = 'baz'"
     * console.log(stmt);
     * // => "SELECT * FROM foo WHERE bar = 'baz'"
     * ```
     */
    toString(): string;

    /**
     * Native object representing the underlying `sqlite3_stmt`
     *
     * This is left untyped because the ABI of the native bindings may change at any time.
     */
    readonly native: any;
  }

  /**
   * Constants from `sqlite3.h`
   *
   * This list isn't exhaustive, but some of the ones which are relevant
   */
  export const constants: {
    /**
     * Open the database as read-only (no write operations, no create).
     * @value 0x00000001
     */
    SQLITE_OPEN_READONLY: number;
    /**
     * Open the database for reading and writing
     * @value 0x00000002
     */
    SQLITE_OPEN_READWRITE: number;
    /**
     * Allow creating a new database
     * @value 0x00000004
     */
    SQLITE_OPEN_CREATE: number;
    /**
     *
     * @value 0x00000008
     */
    SQLITE_OPEN_DELETEONCLOSE: number;
    /**
     *
     * @value 0x00000010
     */
    SQLITE_OPEN_EXCLUSIVE: number;
    /**
     *
     * @value 0x00000020
     */
    SQLITE_OPEN_AUTOPROXY: number;
    /**
     *
     * @value 0x00000040
     */
    SQLITE_OPEN_URI: number;
    /**
     *
     * @value 0x00000080
     */
    SQLITE_OPEN_MEMORY: number;
    /**
     *
     * @value 0x00000100
     */
    SQLITE_OPEN_MAIN_DB: number;
    /**
     *
     * @value 0x00000200
     */
    SQLITE_OPEN_TEMP_DB: number;
    /**
     *
     * @value 0x00000400
     */
    SQLITE_OPEN_TRANSIENT_DB: number;
    /**
     *
     * @value 0x00000800
     */
    SQLITE_OPEN_MAIN_JOURNAL: number;
    /**
     *
     * @value 0x00001000
     */
    SQLITE_OPEN_TEMP_JOURNAL: number;
    /**
     *
     * @value 0x00002000
     */
    SQLITE_OPEN_SUBJOURNAL: number;
    /**
     *
     * @value 0x00004000
     */
    SQLITE_OPEN_SUPER_JOURNAL: number;
    /**
     *
     * @value 0x00008000
     */
    SQLITE_OPEN_NOMUTEX: number;
    /**
     *
     * @value 0x00010000
     */
    SQLITE_OPEN_FULLMUTEX: number;
    /**
     *
     * @value 0x00020000
     */
    SQLITE_OPEN_SHAREDCACHE: number;
    /**
     *
     * @value 0x00040000
     */
    SQLITE_OPEN_PRIVATECACHE: number;
    /**
     *
     * @value 0x00080000
     */
    SQLITE_OPEN_WAL: number;
    /**
     *
     * @value 0x01000000
     */
    SQLITE_OPEN_NOFOLLOW: number;
    /**
     *
     * @value 0x02000000
     */
    SQLITE_OPEN_EXRESCODE: number;
    /**
     *
     * @value 0x01
     */
    SQLITE_PREPARE_PERSISTENT: number;
    /**
     *
     * @value 0x02
     */
    SQLITE_PREPARE_NORMALIZE: number;
    /**
     *
     * @value 0x04
     */
    SQLITE_PREPARE_NO_VTAB: number;
  };

  /**
   * The native module implementing the sqlite3 C bindings
   *
   * It is lazily-initialized, so this will return `undefined` until the first
   * call to new Database().
   *
   * The native module makes no gurantees about ABI stability, so it is left
   * untyped
   *
   * If you need to use it directly for some reason, please let us know because
   * that probably points to a deficiency in this API.
   *
   */
  export var native: any;

  export type SQLQueryBindings =
    | string
    | bigint
    | TypedArray
    | number
    | boolean
    | null
    | Record<string, string | bigint | TypedArray | number | boolean | null>;

  export default Database;
}
