/**
 * Fast SQLite3 driver for Bun
 * @since v0.0.83
 *
 * @example
 * ```ts
 * import { Database } from 'bun:sqlite';
 *
 * const db = new Database('app.db');
 * db.query('SELECT * FROM users WHERE name = ?').all('John');
 * // => [{ id: 1, name: 'John' }]
 * ```
 *
 * The following types can be used when binding parameters:
 *
 * | JavaScript type | SQLite type            |
 * | --------------- | ---------------------- |
 * | `string`        | `TEXT`                 |
 * | `number`        | `INTEGER` or `REAL`    |
 * | `boolean`       | `INTEGER` (1 or 0)     |
 * | `Uint8Array`    | `BLOB`                 |
 * | `Buffer`        | `BLOB`                 |
 * | `ArrayBuffer`   | `BLOB`                 |
 * | `bigint`        | `INTEGER`              |
 * | `null`          | `NULL`                 |
 */
declare module "bun:sqlite" {
  /**
   * Options for {@link Database}
   */
  export interface DatabaseOptions {
    /**
     * Open the database as read-only (no write operations, no create).
     *
     * Equivalent to {@link constants.SQLITE_OPEN_READONLY}
     *
     * Together with `create: true` or `readwrite: true`, the constructor throws a `TypeError`.
     */
    readonly?: boolean | undefined;

    /**
     * Allow creating a new database
     *
     * Equivalent to {@link constants.SQLITE_OPEN_CREATE}
     *
     * When `false`, opening a file that does not exist throws an error with the code `SQLITE_CANTOPEN`.
     */
    create?: boolean | undefined;

    /**
     * Open the database as read-write
     *
     * Equivalent to {@link constants.SQLITE_OPEN_READWRITE}
     *
     * `readwrite: true` without `create: true` does not create the file. `readwrite: false` is the same as `readonly: true`.
     */
    readwrite?: boolean | undefined;

    /**
     * When `true`, integers are returned as `bigint`.
     *
     * When `false`, integers are returned as `number`, and integers beyond 53 bits are rounded to the nearest `number`.
     *
     * When `true`, a `bigint` parameter that does not fit in a signed 64-bit
     * integer throws a `RangeError`. When `false`, it keeps its low 64 bits:
     * `2n ** 64n - 1n` is stored as `-1`.
     *
     * @default false
     * @since v1.1.14
     */
    safeIntegers?: boolean | undefined;

    /**
     * When set to `true`, a query with a missing bound parameter throws an error.
     * When set to `false` or `undefined`, the parameter is `NULL`.
     *
     * In both modes, the key of a named parameter can include the `$`, `:`, or
     * `@` prefix or leave it out. If an object has both keys, the key without
     * the prefix wins in strict mode, and the key with the prefix otherwise.
     *
     * @example
     * ```ts
     * const db = new Database(":memory:", { strict: true });
     * db.run("INSERT INTO foo (name) VALUES ($name)", { name: "foo" });
     * db.run("INSERT INTO foo (name) VALUES ($name)", { nmae: "foo" }); // throws
     * ```
     * @since v1.1.14
     */
    strict?: boolean | undefined;
  }

  /**
   * A SQLite3 database
   *
   * @example
   * ```ts
   * const db = new Database("mydb.sqlite");
   * db.run("CREATE TABLE foo (bar TEXT)");
   * db.run("INSERT INTO foo VALUES (?)", ["baz"]);
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
   * db.run("INSERT INTO foo VALUES (?)", ["hiiiiii"]);
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
  export class Database implements Disposable {
    /**
     * Open or create a SQLite3 database
     *
     * @param filename The filename of the database to open. Pass an empty string (`""`) or `":memory:"` or undefined for an in-memory database.
     * @param options defaults to `{readwrite: true, create: true}`, also for an object that sets none of `readonly`, `create` and `readwrite`. If a number, then it's treated as `SQLITE_OPEN_*` constant flags.
     */
    constructor(filename?: string, options?: number | DatabaseOptions);

    /**
     * Open or create a SQLite3 database
     *
     * @param filename The filename of the database to open. Pass an empty string (`""`) or `":memory:"` or undefined for an in-memory database.
     * @param options defaults to `{readwrite: true, create: true}`, also for an object that sets none of `readonly`, `create` and `readwrite`. If a number, then it's treated as `SQLITE_OPEN_*` constant flags.
     *
     * This is an alias of `new Database()`
     *
     * See {@link Database}
     */
    static open(filename: string, options?: number | DatabaseOptions): Database;

    /**
     * Maximum number of distinct SQL strings {@link Database.query} keeps
     * cached per `Database`. Least-recently-used entries are evicted first.
     * SQL text over 64 KB is never cached.
     * @default 20
     */
    static MAX_QUERY_CACHE_SIZE: number;

    /**
     * Finalize the statements that {@link Database.query} has cached and empty the cache.
     */
    clearQueryCache(): void;

    /**
     * Execute a SQL query **without returning any results**.
     *
     * This does not cache the query. To run a query multiple times, use {@link prepare} instead.
     *
     * Internally, this calls `sqlite3_prepare_v3` followed by `sqlite3_step` and `sqlite3_finalize`.
     *
     * The string can hold several statements, separated by `;`. They run in
     * order, and the first one gets the bindings. The first statement that
     * fails throws, and the statements after it do not run.
     *
     * The following types can be used when binding parameters:
     *
     * | JavaScript type | SQLite type            |
     * | --------------- | ---------------------- |
     * | `string`        | `TEXT`                 |
     * | `number`        | `INTEGER` or `REAL`    |
     * | `boolean`       | `INTEGER` (1 or 0)     |
     * | `Uint8Array`    | `BLOB`                 |
     * | `Buffer`        | `BLOB`                 |
     * | `bigint`        | `INTEGER`              |
     * | `null`          | `NULL`                 |
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
     * @param bindings Optional bindings for the query
     * @returns A `Changes` object with `changes` and `lastInsertRowid` properties
     *
     * @example
     * ```ts
     * db.run("CREATE TABLE foo (bar TEXT)");
     * db.run("INSERT INTO foo VALUES (?)", ["baz"]);
     * // => { changes: 1, lastInsertRowid: 1 }
     * ```
     */
    run<ParamsType extends SQLQueryBindings[]>(sql: string, ...bindings: ParamsType[]): Changes;

    /**
     * This is an alias of {@link Database.run}
     *
     * @deprecated Prefer {@link Database.run}
     */
    exec<ParamsType extends SQLQueryBindings[]>(sql: string, ...bindings: ParamsType[]): Changes;

    /**
     * Compile a SQL query and return a {@link Statement} object. This is the
     * same as {@link prepare} except that it caches the compiled query if
     * possible.
     *
     * This **does not execute** the query; it prepares it for later execution.
     *
     * Internally, this calls `sqlite3_prepare_v3`, which compiles the first
     * statement of the string and ignores the rest. {@link run} runs them all.
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
     * @returns A {@link Statement} instance
     */
    query<ReturnType, ParamsType extends SQLQueryBindings | SQLQueryBindings[]>(
      sql: string,
    ): Statement<ReturnType, ParamsType extends any[] ? ParamsType : [ParamsType]>;

    /**
     * Compile a SQL query and return a {@link Statement} object.
     *
     * This does not cache the compiled query and does not execute the query.
     *
     * Internally, this calls `sqlite3_prepare_v3`, which compiles the first
     * statement of the string and ignores the rest. {@link run} runs them all.
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
     * @returns A {@link Statement} instance
     */
    prepare<ReturnType, ParamsType extends SQLQueryBindings | SQLQueryBindings[]>(
      sql: string,
      params?: ParamsType,
    ): Statement<ReturnType, ParamsType extends any[] ? ParamsType : [ParamsType]>;

    /**
     * Whether the database is in a transaction.
     *
     * @returns `true` if the database is in a transaction, `false` otherwise
     *
     * @example
     * ```ts
     * db.run("CREATE TABLE foo (bar TEXT)");
     * db.run("INSERT INTO foo VALUES (?)", ["baz"]);
     * db.run("BEGIN");
     * db.run("INSERT INTO foo VALUES (?)", ["qux"]);
     * console.log(db.inTransaction);
     * // => true
     * ```
     */
    get inTransaction(): boolean;

    /**
     * Close the database connection.
     *
     * Statements created with {@link Database.query} are finalized
     * immediately. With `throwOnError` unset or `false`, statements created
     * with {@link Database.prepare} keep working until they are finalized or
     * garbage collected, and the underlying connection is released after the
     * last one (`sqlite3_close_v2`). With `throwOnError: true`, every
     * outstanding statement is finalized, the connection is released
     * immediately (`sqlite3_close`), and an error is thrown if SQLite fails
     * to close it.
     *
     * It is safe to call this method multiple times. If the database is
     * already closed, this is a no-op. Creating new statements after close
     * throws; using a statement that close finalized throws
     * `Database has closed`, except `toString()`, which returns an empty
     * string, and `finalize()`, which stays safe to call.
     *
     * @example
     * ```ts
     * db.close();
     * ```
     * If a `Database` is garbage collected without being closed, the
     * connection is released once every statement created from it has also
     * been finalized or collected. `using db = ...` calls `close(true)`.
     */
    close(
      /**
       * If `true`, finalize every outstanding statement and throw if the connection fails to close
       * @default false
       *
       * Learn more in the [sqlite3 documentation](https://www.sqlite.org/c3ref/close.html).
       *
       * In the future, Bun may default `throwOnError` to `true`, but for backwards compatibility it is `false` by default.
       */
      throwOnError?: boolean,
    ): void;

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
     * A number that identifies this `Database` in the process
     *
     * This is not a file descriptor. It stays the same after `close()`, and no other `Database` gets it.
     */
    readonly handle: number;

    /**
     * Load a SQLite3 extension
     *
     * On macOS, this requires linking a custom SQLite3 library because the Apple build of SQLite disables loading extensions. See {@link Database.setCustomSQLite}
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
     * The initial call only works before SQLite is loaded, that is,
     * before you call `new Database()`. Later calls with the exact same path
     * are idempotent so workers can adopt the process-wide selection.
     * A different path is rejected after SQLite loads.
     *
     * @param path The path to the SQLite library
     * @returns `false` where SQLite is statically linked into Bun (Linux, Windows): nothing was loaded
     */
    static setCustomSQLite(path: string): boolean;

    /**
     * Closes the database at the end of a `using` block (explicit resource management)
     *
     * @example
     * ```ts
     * using db = new Database("myapp.db");
     * doSomethingWithDatabase(db);
     * // Automatically closed when `db` goes out of scope
     * ```
     */
    [Symbol.dispose](): void;

    /**
     * Creates a function that always runs inside a transaction. When the
     * function is invoked, it begins a new transaction. When the function
     * returns, the transaction is committed. If an exception is thrown, the
     * transaction is rolled back (and the exception propagates as usual).
     *
     * The function must be synchronous, because the transaction is committed
     * when it returns. An `async` function returns at its first `await`:
     * everything after that `await` runs outside the transaction, and an error
     * thrown there does not roll anything back. Do the awaited work first and
     * pass the results in.
     *
     * If the function returns a promise that is already rejected, as an `async`
     * function does when it throws before its first `await`, the transaction is
     * rolled back and the promise is returned.
     *
     * @param insideTransaction The synchronous callback which runs inside a transaction
     *
     * @example
     * ```ts
     * // setup
     * import { Database } from "bun:sqlite";
     * const db = Database.open(":memory:");
     * db.run(
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
    transaction<A extends any[], T>(
      insideTransaction: (...args: A) => T,
    ): {
      /**
       * Execute the transaction
       */
      (...args: A): T;

      /**
       * Execute the transaction using "BEGIN DEFERRED"
       */
      deferred: (...args: A) => T;

      /**
       * Execute the transaction using "BEGIN IMMEDIATE"
       */
      immediate: (...args: A) => T;

      /**
       * Execute the transaction using "BEGIN EXCLUSIVE"
       */
      exclusive: (...args: A) => T;
    };

    /**
     * Define a SQL function that calls a JavaScript function.
     *
     * The number of parameters of `fn` (`fn.length`) is the number of arguments
     * the SQL function takes, unless `varargs` is set. Functions with the same
     * name and different numbers of arguments exist side by side. A function
     * with the same name and number of arguments replaces the earlier one, also
     * a function that is built into SQLite.
     *
     * An argument has the type that a column of a result row has: `INTEGER` is a
     * `number` (a `bigint` with `safeIntegers`), `BLOB` is a `Uint8Array`. The
     * return value is stored like a bound parameter, and `undefined` is `NULL`.
     * Any other return value, such as an object or a promise, makes the query
     * throw a `TypeError`.
     *
     * What `fn` throws ends the query, and the call that ran the query
     * (`get()`, `all()`, `run()`, ...) throws the same value.
     *
     * While `fn` runs, every other use of this `Database` and of its statements
     * throws `TypeError: This database connection is busy executing a query`.
     *
     * @param name Name of the SQL function
     * @param fn Called with `this` set to `undefined`
     * @returns The `Database`
     *
     * @example
     * ```ts
     * db.function("add2", (a, b) => a + b);
     * db.query("SELECT add2(12, 4) AS sum").get();
     * // => { sum: 16 }
     *
     * db.function("count_args", { varargs: true }, (...args) => args.length);
     * db.query("SELECT count_args(1, 2, 3) AS n").get();
     * // => { n: 3 }
     * ```
     */
    function(name: string, fn: (...args: any[]) => SQLFunctionResult): this;
    function(name: string, options: FunctionOptions, fn: (...args: any[]) => SQLFunctionResult): this;

    /**
     * Define a SQL aggregate function, such as `sum()` or `group_concat()`, that
     * calls JavaScript functions. With `inverse` it is also a
     * [window function](https://www.sqlite.org/windowfunctions.html).
     *
     * What is said about arguments, results, thrown values and the use of the
     * `Database` in {@link Database.function} holds for each callback.
     *
     * @param name Name of the SQL function
     * @returns The `Database`
     *
     * @example
     * ```ts
     * db.aggregate("add_all", {
     *   start: 0,
     *   step: (total, value) => total + value,
     * });
     * db.query("SELECT add_all(dollars) AS total FROM expenses").get();
     * // => { total: 92 }
     * ```
     */
    aggregate<T = any>(name: string, options: AggregateOptions<T>): this;

    /**
     * Called after a row is inserted through this `Database`. `null` when not set.
     * Set it to `null` to remove it.
     *
     * Internally, `onInsert`, {@link onUpdate} and {@link onDelete} are one
     * [`sqlite3_update_hook`](https://www.sqlite.org/c3ref/update_hook.html).
     * SQLite calls it while the statement runs, for each row, before a
     * transaction commits. A change that is rolled back later has been reported.
     *
     * SQLite does not report:
     * - changes to a `WITHOUT ROWID` table
     * - the rows of a `DELETE` without `WHERE` on a table without triggers, which empties the table in one step
     * - a row that `INSERT OR REPLACE` removes
     * - changes made by another connection or process
     *
     * While the function runs, every other use of this `Database` and of its
     * statements throws `TypeError: This database connection is busy executing a query`.
     * To query the database, wait until the statement has ended, for example
     * with `queueMicrotask()`.
     *
     * The function cannot stop the statement. What it throws is reported as an
     * uncaught exception (`process.on("uncaughtException")`), and the statement
     * goes on.
     *
     * @example
     * ```ts
     * db.onInsert = (db, tableName, rowid) => {
     *   console.log(`inserted ${tableName} ${rowid}`);
     * };
     * db.run("INSERT INTO cats (name) VALUES (?)", "Salem");
     * // inserted cats 1
     * ```
     */
    get onInsert(): UpdateHook | null;
    set onInsert(hook: UpdateHook | null | undefined);

    /**
     * Called after a row is updated through this `Database`. `null` when not set.
     * `rowid` is the rowid that the row has after the update.
     *
     * See {@link onInsert}.
     */
    get onUpdate(): UpdateHook | null;
    set onUpdate(hook: UpdateHook | null | undefined);

    /**
     * Called after a row is deleted through this `Database`. `null` when not set.
     *
     * See {@link onInsert}.
     */
    get onDelete(): UpdateHook | null;
    set onDelete(hook: UpdateHook | null | undefined);

    /**
     * Save the database to an in-memory {@link Buffer} object.
     *
     * Internally, this calls `sqlite3_serialize`.
     *
     * @param name Name to save the database as @default "main"
     * @returns Buffer containing the serialized database
     */
    serialize(name?: string): Buffer;

    /**
     * Load a serialized SQLite3 database
     *
     * Internally, this calls `sqlite3_deserialize`.
     *
     * @param serialized Data to load
     * @returns `Database` instance
     *
     * @example
     * ```ts
     * test("supports serialize/deserialize", () => {
     *     const db = Database.open(":memory:");
     *     db.run("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
     *     db.run('INSERT INTO test (name) VALUES ("Hello")');
     *     db.run('INSERT INTO test (name) VALUES ("World")');
     *
     *     const input = db.serialize();
     *     const db2 = new Database(input);
     *
     *     const stmt = db2.prepare("SELECT * FROM test");
     *     expect(JSON.stringify(stmt.get())).toBe(
     *       JSON.stringify({
     *         id: 1,
     *         name: "Hello",
     *       }),
     *     );
     *
     *     expect(JSON.stringify(stmt.all())).toBe(
     *       JSON.stringify([
     *         {
     *           id: 1,
     *           name: "Hello",
     *         },
     *         {
     *           id: 2,
     *           name: "World",
     *         },
     *       ]),
     *     );
     *     db2.run("insert into test (name) values ('foo')");
     *     expect(JSON.stringify(stmt.all())).toBe(
     *       JSON.stringify([
     *         {
     *           id: 1,
     *           name: "Hello",
     *         },
     *         {
     *           id: 2,
     *           name: "World",
     *         },
     *         {
     *           id: 3,
     *           name: "foo",
     *         },
     *       ]),
     *     );
     *
     *     const db3 = Database.deserialize(input, true);
     *     try {
     *       db3.run("insert into test (name) values ('foo')");
     *       throw new Error("Expected error");
     *     } catch (e) {
     *       expect(e.message).toBe("attempt to write a readonly database");
     *     }
     * });
     * ```
     */
    static deserialize(serialized: NodeJS.TypedArray | ArrayBufferLike, isReadOnly?: boolean): Database;

    /**
     * Load a serialized SQLite3 database. This overload accepts additional
     * options, such as `strict` to put the database into strict mode.
     *
     * Internally, this calls `sqlite3_deserialize`.
     *
     * @param serialized Data to load
     * @returns `Database` instance
     *
     * @example
     * ```ts
     * test("supports serialize/deserialize", () => {
     *     const db = Database.open(":memory:");
     *     db.run("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
     *     db.run('INSERT INTO test (name) VALUES ("Hello")');
     *     db.run('INSERT INTO test (name) VALUES ("World")');
     *
     *     const input = db.serialize();
     *     const db2 = Database.deserialize(input, { strict: true });
     *
     *     const stmt = db2.prepare("SELECT * FROM test");
     *     expect(JSON.stringify(stmt.get())).toBe(
     *       JSON.stringify({
     *         id: 1,
     *         name: "Hello",
     *       }),
     *     );
     *
     *     expect(JSON.stringify(stmt.all())).toBe(
     *       JSON.stringify([
     *         {
     *           id: 1,
     *           name: "Hello",
     *         },
     *         {
     *           id: 2,
     *           name: "World",
     *         },
     *       ]),
     *     );
     *     db2.run("insert into test (name) values ($foo)", { foo: "baz" });
     *     expect(JSON.stringify(stmt.all())).toBe(
     *       JSON.stringify([
     *         {
     *           id: 1,
     *           name: "Hello",
     *         },
     *         {
     *           id: 2,
     *           name: "World",
     *         },
     *         {
     *           id: 3,
     *           name: "baz",
     *         },
     *       ]),
     *     );
     *
     *     const db3 = Database.deserialize(input, { readonly: true, strict: true });
     *     try {
     *       db3.run("insert into test (name) values ($foo)", { foo: "baz" });
     *       throw new Error("Expected error");
     *     } catch (e) {
     *       expect(e.message).toBe("attempt to write a readonly database");
     *     }
     * });
     * ```
     */
    static deserialize(
      serialized: NodeJS.TypedArray | ArrayBufferLike,
      options?: Pick<DatabaseOptions, "readonly" | "strict" | "safeIntegers">,
    ): Database;

    /**
     * Call `sqlite3_file_control` on the `main` database.
     *
     * SQLite reads the input of `op` from `arg` and writes its output there.
     *
     * - A `number` is passed as a 32-bit integer. What SQLite writes back is not returned.
     * - A `TypedArray` or `DataView` of at least 8 bytes is passed as is. Use it to read what SQLite writes back.
     * - `null` or no argument is for an `op` that takes none, such as `SQLITE_FCNTL_RESET_CACHE`. An `op` that reads its argument reads `-1`.
     *
     * @returns The SQLite status code. `0` is `SQLITE_OK`. `12` is `SQLITE_NOTFOUND`: the VFS does not implement `op`, or the database is in memory.
     *
     * @example
     * ```ts
     * // -1 asks for the flag. SQLite writes 0 or 1 to the first element.
     * const flag = new Int32Array([-1, 0]);
     * db.fileControl(constants.SQLITE_FCNTL_PERSIST_WAL, flag);
     * console.log(flag[0]);
     * ```
     *
     * @link https://www.sqlite.org/c3ref/file_control.html
     */
    fileControl(op: number, arg?: ArrayBufferView | number | null): number;
    /**
     * Call `sqlite3_file_control` on the database with the schema name `zDbName`: `"main"` or the name of an attached database.
     * @link https://www.sqlite.org/c3ref/file_control.html
     */
    fileControl(zDbName: string, op: number, arg?: ArrayBufferView | number | null): number;
  }

  /**
   * A prepared statement.
   *
   * This is returned by {@link Database.prepare} and {@link Database.query}.
   *
   * @category Database
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
   * ```
   */
  export class Statement<ReturnType = unknown, ParamsType extends SQLQueryBindings[] = any[]> implements Disposable {
    /**
     * Creates a new prepared statement from native code.
     *
     * Used internally by the {@link Database} class. You don't need to call this yourself.
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
     * stmt.all();
     * // => [] (nothing is bound yet)
     *
     * stmt.all("baz");
     * // => [{bar: "baz"}]
     *
     * stmt.all();
     * // => [{bar: "baz"}] (the last bound value)
     *
     * stmt.all("foo");
     * // => [{bar: "foo"}]
     * ```
     */
    all(...params: ParamsType): ReturnType[];

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
     * stmt.get();
     * // => null (nothing is bound yet)
     *
     * stmt.get("baz");
     * // => {bar: "baz"}
     *
     * stmt.get();
     * // => {bar: "baz"} (the last bound value)
     *
     * stmt.get("foo");
     * // => {bar: "foo"}
     * ```
     *
     * The following types can be used when binding parameters:
     *
     * | JavaScript type | SQLite type            |
     * | --------------- | ---------------------- |
     * | `string`        | `TEXT`                 |
     * | `number`        | `INTEGER` or `REAL`    |
     * | `boolean`       | `INTEGER` (1 or 0)     |
     * | `Uint8Array`    | `BLOB`                 |
     * | `Buffer`        | `BLOB`                 |
     * | `bigint`        | `INTEGER`              |
     * | `null`          | `NULL`                 |
     */
    get(...params: ParamsType): ReturnType | null;

    /**
     * Execute the prepared statement and return an iterator over the results.
     *
     * A statement has one cursor, and its newest run owns it: after another
     * call of `get`, `all`, `values`, `raw`, `run` or `iterate` on the same
     * `Statement`, the next step of this iterator throws. Use
     * {@link Database.prepare} to get a statement with a cursor of its own.
     *
     * @param params optional values to bind to the statement. If omitted, the statement is run with the last bound values or no parameters if there are none.
     */
    iterate(...params: ParamsType): IterableIterator<ReturnType>;
    [Symbol.iterator](): IterableIterator<ReturnType>;

    /**
     * Execute the prepared statement.
     *
     * @param params optional values to bind to the statement. If omitted, the statement is run with the last bound values or no parameters if there are none.
     * @returns A `Changes` object with `changes` and `lastInsertRowid` properties
     *
     * @example
     * ```ts
     * const insert = db.prepare("INSERT INTO users (name) VALUES (?)");
     * insert.run("Alice");
     * // => { changes: 1, lastInsertRowid: 1 }
     * insert.run("Bob");
     * // => { changes: 1, lastInsertRowid: 2 }
     *
     * const update = db.prepare("UPDATE users SET name = ? WHERE id = ?");
     * update.run("Charlie", 1);
     * // => { changes: 1, lastInsertRowid: 2 }
     * ```
     *
     * The following types can be used when binding parameters:
     *
     * | JavaScript type | SQLite type            |
     * | --------------- | ---------------------- |
     * | `string`        | `TEXT`                 |
     * | `number`        | `INTEGER` or `REAL`    |
     * | `boolean`       | `INTEGER` (1 or 0)     |
     * | `Uint8Array`    | `BLOB`                 |
     * | `Buffer`        | `BLOB`                 |
     * | `bigint`        | `INTEGER`              |
     * | `null`          | `NULL`                 |
     */
    run(...params: ParamsType): Changes;

    /**
     * Execute the prepared statement and return the results as an array of arrays.
     *
     * If there are no results, returns an empty array.
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
     *
     * stmt.values("not-found");
     * // => []
     * ```
     *
     * The following types can be used when binding parameters:
     *
     * | JavaScript type | SQLite type            |
     * | --------------- | ---------------------- |
     * | `string`        | `TEXT`                 |
     * | `number`        | `INTEGER` or `REAL`    |
     * | `boolean`       | `INTEGER` (1 or 0)     |
     * | `Uint8Array`    | `BLOB`                 |
     * | `Buffer`        | `BLOB`                 |
     * | `bigint`        | `INTEGER`              |
     * | `null`          | `NULL`                 |
     */
    values(...params: ParamsType): Array<Array<string | bigint | number | Uint8Array | null>>;

    /**
     * Execute the prepared statement and return all results as arrays of
     * `Uint8Array`s.
     *
     * This is similar to {@link values} but returns every value as a
     * `Uint8Array`, regardless of its original SQLite type.
     *
     * @param params optional values to bind to the statement. If omitted, the
     * statement is run with the last bound values or no parameters if there are
     * none.
     *
     * @example
     * ```ts
     * const stmt = db.prepare("SELECT * FROM foo WHERE bar = ?");
     *
     * stmt.raw("baz");
     * // => [[Uint8Array(24)]]
     *
     * stmt.raw();
     * // => [[Uint8Array(24)]]
     * ```
     */
    raw(...params: ParamsType): Array<Array<Uint8Array | null>>;

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
     */
    readonly paramsCount: number;

    /**
     * Whether the prepared statement returns rows: it has at least one column.
     *
     * `true` for `SELECT`, for `INSERT ... RETURNING` and for a `PRAGMA` that reports a value.
     */
    readonly reader: boolean;

    /**
     * Whether the prepared statement makes no direct change to the database file, as reported by `sqlite3_stmt_readonly()`.
     *
     * `BEGIN`, `COMMIT` and `SAVEPOINT` are read-only in this sense.
     */
    readonly readonly: boolean;

    /**
     * Whether {@link finalize} was called, or the {@link Database} finalized the statement when it closed.
     */
    readonly isFinalized: boolean;

    /**
     * The actual SQLite column types from the first row of the result set, as
     * reported by `sqlite3_column_type()`. Useful for expressions and computed
     * columns, which are not covered by {@link declaredTypes}.
     *
     * Returns an array of SQLite type constants as uppercase strings:
     * - `"INTEGER"` for integer values
     * - `"FLOAT"` for floating-point values
     * - `"TEXT"` for text values
     * - `"BLOB"` for binary data
     * - `"NULL"` for null values
     * - `null` for unknown/unsupported types
     *
     * Only available for read-only statements (SELECT queries). For other
     * statements, accessing this property throws an error.
     *
     * @example
     * ```ts
     * const stmt = db.prepare("SELECT id, name, age FROM users WHERE id = 1");
     *
     * console.log(stmt.columnTypes);
     * // => ["INTEGER", "TEXT", "INTEGER"]
     *
     * // For expressions:
     * const exprStmt = db.prepare("SELECT length('bun') AS str_length");
     * console.log(exprStmt.columnTypes);
     * // => ["INTEGER"]
     * ```
     *
     * @throws Error if statement is not read-only (INSERT, UPDATE, DELETE, etc.)
     * @since Bun v1.2.13
     */
    readonly columnTypes: Array<"INTEGER" | "FLOAT" | "TEXT" | "BLOB" | "NULL" | null>;

    /**
     * The declared column types from the table schema, as reported by
     * `sqlite3_column_decltype()`.
     *
     * Returns an array of:
     * - The exact type string declared in the `CREATE TABLE` statement
     * - `null` for columns without declared types, such as expressions and computed columns
     *
     * Available for both read-only and read-write statements, before and
     * after they run.
     *
     * @example
     * ```ts
     * // For table columns:
     * const stmt = db.prepare("SELECT id, name, weight FROM products");
     * console.log(stmt.declaredTypes);
     * // => ["INTEGER", "TEXT", "REAL"]
     *
     * // For expressions (no declared types):
     * const exprStmt = db.prepare("SELECT length('bun') AS str_length");
     * console.log(exprStmt.declaredTypes);
     * // => [null]
     * ```
     *
     * @since Bun v1.2.13
     */
    readonly declaredTypes: Array<string | null>;

    /**
     * Set whether this statement returns integers as `bigint`. The default is
     * the `safeIntegers` option of the {@link Database}.
     *
     * With `false`, integers are returned as `number`, and integers beyond 53
     * bits are rounded to the nearest `number`. The setting also decides the
     * type of `lastInsertRowid` in the result of {@link run}.
     *
     * {@link Database.query} returns the same `Statement` for the same SQL, so
     * the setting stays for its next caller.
     *
     * @returns The same statement
     *
     * @example
     * ```ts
     * db.run("CREATE TABLE foo (id INTEGER PRIMARY KEY, big INTEGER)");
     * db.run("INSERT INTO foo (big) VALUES (?)", BigInt(Number.MAX_SAFE_INTEGER) + 10n);
     * const stmt = db.prepare("SELECT * FROM foo");
     *
     * stmt.all();
     * // => [{ id: 1, big: 9007199254741000 }]
     *
     * stmt.safeIntegers(true).all();
     * // => [{ id: 1n, big: 9007199254741001n }]
     * ```
     */
    safeIntegers(enabled: boolean): this;
    /**
     * Whether this statement returns integers as `bigint`.
     */
    safeIntegers(): boolean;

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
     * Calls {@link finalize} if it wasn't already called.
     */
    [Symbol.dispose](): void;

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
     * What `JSON.stringify()` shows for the statement.
     */
    toJSON(): { sql: string; isFinalized: boolean; paramsCount: number; columnNames: string[] };

    /**
     * Make {@link get} and {@link all} return an instance of the provided
     * `Class` instead of the default `Object`, so the returned objects can have
     * methods, getters, and setters.
     *
     * For performance reasons, class constructors are not called: initializers
     * do not run and private fields are not accessible.
     *
     * @param Class The class to return rows as
     * @returns The same statement instance, modified to return an instance of `Class`
     *
     * @example
     *
     * ## Custom class
     * ```ts
     * class User {
     *    rawBirthdate: string;
     *    get birthdate() {
     *      return new Date(this.rawBirthdate);
     *    }
     * }
     *
     * const db = new Database(":memory:");
     * db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, rawBirthdate TEXT)");
     * db.run("INSERT INTO users (rawBirthdate) VALUES ('1995-12-19')");
     * const query = db.query("SELECT * FROM users");
     * query.as(User);
     * const user = query.get();
     * console.log(user.birthdate);
     * // => Date(1995, 12, 19)
     * ```
     */
    as<T = unknown>(Class: new (...args: any[]) => T): Statement<T, ParamsType>;

    /**
     * Native object representing the underlying `sqlite3_stmt`
     *
     * This is left untyped because the ABI of the native bindings may change at any time.
     *
     * For stable, typed access to statement metadata, use the typed properties on the Statement class:
     * - {@link columnNames} for column names
     * - {@link paramsCount} for parameter count
     * - {@link columnTypes} for actual data types from the first row
     * - {@link declaredTypes} for schema-declared column types
     */
    readonly native: any;
  }

  /**
   * Constants from `sqlite3.h`
   *
   * This list isn't exhaustive; it covers the most relevant ones
   */
  export namespace constants {
    /**
     * Open the database as read-only (no write operations, no create).
     * @constant 0x00000001
     */
    const SQLITE_OPEN_READONLY: number;
    /**
     * Open the database for reading and writing
     * @constant 0x00000002
     */
    const SQLITE_OPEN_READWRITE: number;
    /**
     * Allow creating a new database
     * @constant 0x00000004
     */
    const SQLITE_OPEN_CREATE: number;
    /**
     * @constant 0x00000008
     */
    const SQLITE_OPEN_DELETEONCLOSE: number;
    /**
     * @constant 0x00000010
     */
    const SQLITE_OPEN_EXCLUSIVE: number;
    /**
     * @constant 0x00000020
     */
    const SQLITE_OPEN_AUTOPROXY: number;
    /**
     * @constant 0x00000040
     */
    const SQLITE_OPEN_URI: number;
    /**
     * @constant 0x00000080
     */
    const SQLITE_OPEN_MEMORY: number;
    /**
     * @constant 0x00000100
     */
    const SQLITE_OPEN_MAIN_DB: number;
    /**
     * @constant 0x00000200
     */
    const SQLITE_OPEN_TEMP_DB: number;
    /**
     * @constant 0x00000400
     */
    const SQLITE_OPEN_TRANSIENT_DB: number;
    /**
     * @constant 0x00000800
     */
    const SQLITE_OPEN_MAIN_JOURNAL: number;
    /**
     * @constant 0x00001000
     */
    const SQLITE_OPEN_TEMP_JOURNAL: number;
    /**
     * @constant 0x00002000
     */
    const SQLITE_OPEN_SUBJOURNAL: number;
    /**
     * @constant 0x00004000
     */
    const SQLITE_OPEN_SUPER_JOURNAL: number;
    /**
     * @constant 0x00008000
     */
    const SQLITE_OPEN_NOMUTEX: number;
    /**
     * @constant 0x00010000
     */
    const SQLITE_OPEN_FULLMUTEX: number;
    /**
     * @constant 0x00020000
     */
    const SQLITE_OPEN_SHAREDCACHE: number;
    /**
     * @constant 0x00040000
     */
    const SQLITE_OPEN_PRIVATECACHE: number;
    /**
     * @constant 0x00080000
     */
    const SQLITE_OPEN_WAL: number;
    /**
     * @constant 0x01000000
     */
    const SQLITE_OPEN_NOFOLLOW: number;
    /**
     * @constant 0x02000000
     */
    const SQLITE_OPEN_EXRESCODE: number;
    /**
     * @constant 0x01
     */
    const SQLITE_PREPARE_PERSISTENT: number;
    /**
     * @constant 0x02
     */
    const SQLITE_PREPARE_NORMALIZE: number;
    /**
     * @constant 0x04
     */
    const SQLITE_PREPARE_NO_VTAB: number;
    /**
     * @constant 1
     */
    const SQLITE_FCNTL_LOCKSTATE: number;
    /**
     * @constant 2
     */
    const SQLITE_FCNTL_GET_LOCKPROXYFILE: number;
    /**
     * @constant 3
     */
    const SQLITE_FCNTL_SET_LOCKPROXYFILE: number;
    /**
     * @constant 4
     */
    const SQLITE_FCNTL_LAST_ERRNO: number;
    /**
     * @constant 5
     */
    const SQLITE_FCNTL_SIZE_HINT: number;
    /**
     * @constant 6
     */
    const SQLITE_FCNTL_CHUNK_SIZE: number;
    /**
     * @constant 7
     */
    const SQLITE_FCNTL_FILE_POINTER: number;
    /**
     * @constant 8
     */
    const SQLITE_FCNTL_SYNC_OMITTED: number;
    /**
     * @constant 9
     */
    const SQLITE_FCNTL_WIN32_AV_RETRY: number;
    /**
     * @constant 10
     *
     * Control whether the WAL (write-ahead log) is persisted.
     * Some versions of macOS configure WAL to be persistent by default.
     *
     * To change this:
     * ```ts
     * import { Database, constants } from "bun:sqlite";
     *
     * const db = Database.open("mydb.sqlite");
     * db.fileControl(constants.SQLITE_FCNTL_PERSIST_WAL, 0);
     * // enable WAL
     * db.run("PRAGMA journal_mode = WAL");
     * // .. do some work
     * db.close();
     * ```
     *
     */
    const SQLITE_FCNTL_PERSIST_WAL: number;
    /**
     * @constant 11
     */
    const SQLITE_FCNTL_OVERWRITE: number;
    /**
     * @constant 12
     */
    const SQLITE_FCNTL_VFSNAME: number;
    /**
     * @constant 13
     */
    const SQLITE_FCNTL_POWERSAFE_OVERWRITE: number;
    /**
     * @constant 14
     */
    const SQLITE_FCNTL_PRAGMA: number;
    /**
     * @constant 15
     */
    const SQLITE_FCNTL_BUSYHANDLER: number;
    /**
     * @constant 16
     */
    const SQLITE_FCNTL_TEMPFILENAME: number;
    /**
     * @constant 18
     */
    const SQLITE_FCNTL_MMAP_SIZE: number;
    /**
     * @constant 19
     */
    const SQLITE_FCNTL_TRACE: number;
    /**
     * @constant 20
     */
    const SQLITE_FCNTL_HAS_MOVED: number;
    /**
     * @constant 21
     */
    const SQLITE_FCNTL_SYNC: number;
    /**
     * @constant 22
     */
    const SQLITE_FCNTL_COMMIT_PHASETWO: number;
    /**
     * @constant 23
     */
    const SQLITE_FCNTL_WIN32_SET_HANDLE: number;
    /**
     * @constant 24
     */
    const SQLITE_FCNTL_WAL_BLOCK: number;
    /**
     * @constant 25
     */
    const SQLITE_FCNTL_ZIPVFS: number;
    /**
     * @constant 26
     */
    const SQLITE_FCNTL_RBU: number;
    /**
     * @constant 27
     */
    const SQLITE_FCNTL_VFS_POINTER: number;
    /**
     * @constant 28
     */
    const SQLITE_FCNTL_JOURNAL_POINTER: number;
    /**
     * @constant 29
     */
    const SQLITE_FCNTL_WIN32_GET_HANDLE: number;
    /**
     * @constant 30
     */
    const SQLITE_FCNTL_PDB: number;
    /**
     * @constant 31
     */
    const SQLITE_FCNTL_BEGIN_ATOMIC_WRITE: number;
    /**
     * @constant 32
     */
    const SQLITE_FCNTL_COMMIT_ATOMIC_WRITE: number;
    /**
     * @constant 33
     */
    const SQLITE_FCNTL_ROLLBACK_ATOMIC_WRITE: number;
    /**
     * @constant 34
     */
    const SQLITE_FCNTL_LOCK_TIMEOUT: number;
    /**
     * @constant 35
     */
    const SQLITE_FCNTL_DATA_VERSION: number;
    /**
     * @constant 36
     */
    const SQLITE_FCNTL_SIZE_LIMIT: number;
    /**
     * @constant 37
     */
    const SQLITE_FCNTL_CKPT_DONE: number;
    /**
     * @constant 38
     */
    const SQLITE_FCNTL_RESERVE_BYTES: number;
    /**
     * @constant 39
     */
    const SQLITE_FCNTL_CKPT_START: number;
    /**
     * @constant 40
     */
    const SQLITE_FCNTL_EXTERNAL_READER: number;
    /**
     * @constant 41
     */
    const SQLITE_FCNTL_CKSM_FILE: number;
    /**
     * @constant 42
     */
    const SQLITE_FCNTL_RESET_CACHE: number;
  }

  export type SQLQueryBindings =
    | string
    | bigint
    | NodeJS.TypedArray
    | ArrayBufferLike
    | number
    | boolean
    | null
    | Record<string, string | bigint | NodeJS.TypedArray | ArrayBufferLike | number | boolean | null>;

  /**
   * What a function defined with {@link Database.function} or
   * {@link Database.aggregate} can return. `undefined` is stored as `NULL`.
   */
  export type SQLFunctionResult =
    string | bigint | NodeJS.TypedArray | ArrayBufferLike | number | boolean | null | undefined | void;

  /**
   * Options for {@link Database.function} and {@link Database.aggregate}
   */
  export interface FunctionOptions {
    /**
     * The SQL function takes any number of arguments, whatever the number of
     * parameters of the JavaScript function.
     *
     * @default false
     */
    varargs?: boolean | undefined;

    /**
     * Promise SQLite that the function returns the same result for the same
     * arguments. SQLite then allows it in an index and in a generated column,
     * and can call it fewer times.
     *
     * Equivalent to `SQLITE_DETERMINISTIC`
     *
     * @default false
     */
    deterministic?: boolean | undefined;

    /**
     * Only SQL that is passed to the `Database` can call the function. A view,
     * a trigger or another part of the schema cannot. Use it for a function
     * with side effects when the database file comes from somebody else.
     *
     * Equivalent to `SQLITE_DIRECTONLY`
     *
     * @default false
     */
    directOnly?: boolean | undefined;

    /**
     * An `INTEGER` argument is a `bigint` instead of a `number`, and a `bigint`
     * result that does not fit in a signed 64-bit integer throws a `RangeError`.
     *
     * @default the `safeIntegers` option of the `Database`
     */
    safeIntegers?: boolean | undefined;
  }

  /**
   * Options for {@link Database.aggregate}
   */
  export interface AggregateOptions<T = any> extends FunctionOptions {
    /**
     * The accumulator that each group of rows starts with. A function is
     * called for each group and returns it: use one for an object or an array,
     * so that groups do not share it.
     *
     * @default null
     */
    start?: T | (() => T) | undefined;

    /**
     * Called for each row of a group, with the accumulator and the arguments of
     * the SQL function. What it returns is the new accumulator. When it returns
     * `undefined`, the accumulator stays.
     *
     * The number of its parameters after the first one is the number of
     * arguments the SQL function takes, unless `varargs` is set.
     */
    step: (accumulator: T, ...args: any[]) => T | void;

    /**
     * Called for each row that leaves the window, with the arguments that
     * `step` got for that row. It undoes `step`. Without it, the function
     * cannot be used as a window function.
     */
    inverse?: ((accumulator: T, ...args: any[]) => T | void) | null | undefined;

    /**
     * Makes the result of the SQL function from the accumulator. Without it,
     * the accumulator is the result. For a window function it is called once
     * for each row, so it must leave the accumulator as it is.
     */
    result?: ((accumulator: T) => SQLFunctionResult) | null | undefined;
  }

  /**
   * The type of {@link Database.onInsert}, {@link Database.onUpdate} and {@link Database.onDelete}
   *
   * @param database The `Database` that has the hook. It is also `this`.
   * @param tableName The table of the row
   * @param rowid The rowid of the row: a `bigint` if the `Database` has `safeIntegers: true`
   * @param schemaName `"main"`, `"temp"`, or the name an attached database has
   */
  export type UpdateHook = (
    this: Database,
    database: Database,
    tableName: string,
    rowid: number | bigint,
    schemaName: string,
  ) => void;

  export default Database;

  /**
   * An error from SQLite. The `name` is `"SQLiteError"`.
   */
  export class SQLiteError extends Error {
    readonly name: "SQLiteError";

    /**
     * The SQLite3 extended error code
     *
     * This corresponds to `sqlite3_extended_errcode`.
     *
     * @since v1.0.21
     */
    errno: number;

    /**
     * The name of the SQLite3 error code
     *
     * @example
     * ```ts
     * "SQLITE_CONSTRAINT_UNIQUE"
     * ```
     *
     * @since v1.0.21
     */
    code?: string;

    /**
     * The UTF-8 byte offset of the token that the error refers to, counted from
     * the start of the SQL string that was passed, also when a later statement
     * of {@link Database.run} failed. `-1` if the error refers to no token.
     *
     * The offset comes from `sqlite3_error_offset`.
     *
     * @since v1.0.21
     */
    readonly byteOffset: number;
  }

  /**
   * An object representing the changes made to the database since the last `run` or `exec` call.
   *
   * @since Bun v1.1.14
   */
  export interface Changes {
    /**
     * The number of rows that the last `run` or `exec` call inserted, updated, or deleted itself.
     *
     * Rows that a trigger or a foreign key action such as `ON DELETE CASCADE` changes do not count.
     * {@link Database.run} with several statements in one string reports their sum.
     */
    changes: number;

    /**
     * The `rowid` of the most recently inserted row.
     *
     * If `safeIntegers` is `true`, this is a `bigint`. Otherwise, it is a `number`.
     */
    lastInsertRowid: number | bigint;
  }
}
