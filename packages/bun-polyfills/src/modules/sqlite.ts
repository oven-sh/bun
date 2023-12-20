import type * as bun_sqlite from 'bun:sqlite';
import bsqlite3 from 'better-sqlite3';

/*
Not sure where to leave this note so I'll leave it here for now:
There will be an incompatibility in queries that can be executed due to the way better-sqlite3 handles double quotes:
https://github.com/WiseLibs/better-sqlite3/issues/1092#issuecomment-1782321118
The possible solutions are:
- Fork better-sqlite3 and recompile it without SQLITE_DQS=0
- Make Bun's SQLite module use SQLITE_DQS=0 (personally I think this is the better solution going forward)
*/

export const constants = {
    SQLITE_OPEN_READONLY: 0x00000001 /* Ok for sqlite3_open_v2() */,
    SQLITE_OPEN_READWRITE: 0x00000002 /* Ok for sqlite3_open_v2() */,
    SQLITE_OPEN_CREATE: 0x00000004 /* Ok for sqlite3_open_v2() */,
    SQLITE_OPEN_DELETEONCLOSE: 0x00000008 /* VFS only */,
    SQLITE_OPEN_EXCLUSIVE: 0x00000010 /* VFS only */,
    SQLITE_OPEN_AUTOPROXY: 0x00000020 /* VFS only */,
    SQLITE_OPEN_URI: 0x00000040 /* Ok for sqlite3_open_v2() */,
    SQLITE_OPEN_MEMORY: 0x00000080 /* Ok for sqlite3_open_v2() */,
    SQLITE_OPEN_MAIN_DB: 0x00000100 /* VFS only */,
    SQLITE_OPEN_TEMP_DB: 0x00000200 /* VFS only */,
    SQLITE_OPEN_TRANSIENT_DB: 0x00000400 /* VFS only */,
    SQLITE_OPEN_MAIN_JOURNAL: 0x00000800 /* VFS only */,
    SQLITE_OPEN_TEMP_JOURNAL: 0x00001000 /* VFS only */,
    SQLITE_OPEN_SUBJOURNAL: 0x00002000 /* VFS only */,
    SQLITE_OPEN_SUPER_JOURNAL: 0x00004000 /* VFS only */,
    SQLITE_OPEN_NOMUTEX: 0x00008000 /* Ok for sqlite3_open_v2() */,
    SQLITE_OPEN_FULLMUTEX: 0x00010000 /* Ok for sqlite3_open_v2() */,
    SQLITE_OPEN_SHAREDCACHE: 0x00020000 /* Ok for sqlite3_open_v2() */,
    SQLITE_OPEN_PRIVATECACHE: 0x00040000 /* Ok for sqlite3_open_v2() */,
    SQLITE_OPEN_WAL: 0x00080000 /* VFS only */,
    SQLITE_OPEN_NOFOLLOW: 0x01000000 /* Ok for sqlite3_open_v2() */,
    SQLITE_OPEN_EXRESCODE: 0x02000000 /* Extended result codes */,
    SQLITE_PREPARE_PERSISTENT: 0x01,
    SQLITE_PREPARE_NORMALIZE: 0x02,
    SQLITE_PREPARE_NO_VTAB: 0x04,
};

let controllers;

export class Statement implements bun_sqlite.Statement {
    constructor(raw: bsqlite3.Statement, boundParams?: bun_sqlite.SQLQueryBindings | bun_sqlite.SQLQueryBindings[]) {
        this.#raw = raw;
        if (boundParams) {
            this.#boundParams = Array.isArray(boundParams) ? boundParams : [boundParams];
            this.#raw.bind(...this.#boundParams);
        }
    }
    isFinalized = false;
    #boundParams: bun_sqlite.SQLQueryBindings[] = [];
    #raw;
    get native() {
        return this.#raw;
    }
    toJSON() {
        return {
            sql: this.toString(),
            isFinalized: this.isFinalized,
            paramsCount: this.paramsCount,
            columnNames: this.columnNames,
        };
    }
    get [Symbol.toStringTag]() {
        return `'${this.toString()}'`;
    }
    toString() {
        return this.#raw.source; // TODO: Does better-sqlite3 really not have a way to get the expanded string? This doesn't update when params are bound...
    }
    get<R>(...args: unknown[]): R | null {
        this.#ASSERT_NOT_FINALIZED();
        const wrap = (() => {
            if (args.length === 0) return this.#raw.get() as R;
            const arg0 = args[0];
            return (!Array.isArray(arg0) && (!arg0 || typeof arg0 !== 'object' || ArrayBuffer.isView(arg0))
                ? this.#raw.get(args) : this.#raw.get(...args)) as R;
        })();
        if (wrap === undefined) return null;
        if (Buffer.isBuffer(wrap)) return new Uint8Array(wrap.buffer, wrap.byteOffset, wrap.byteLength) as unknown as R;
        if (typeof wrap === 'object' && wrap && 'blobby' in wrap && Buffer.isBuffer(wrap.blobby))
            wrap.blobby = new Uint8Array(wrap.blobby.buffer, wrap.blobby.byteOffset, wrap.blobby.byteLength) as unknown as R;
        return wrap;
    }
    all<R extends any[]>(...args: unknown[]): R {
        this.#ASSERT_NOT_FINALIZED();
        const wrapList = (() => {
            if (args.length === 0) return this.#raw.all() as R;
            const arg0 = args[0];
            if (!Array.isArray(arg0) && (!arg0 || typeof arg0 !== 'object' || ArrayBuffer.isView(arg0))) return this.#raw.all(args) as R;
            for (const arg of args) {
                if (typeof arg === 'object' && arg && !Array.isArray(arg)) {
                    const keys = Object.keys(arg);
                    for (const key of keys) {
                        if (key[0] === '$' || key[0] === '@') {
                            const value = Reflect.get(arg, key);
                            Reflect.deleteProperty(arg, key);
                            Reflect.set(arg, key.slice(1), value);
                        }
                    }
                }
            }
            try {
                return this.#raw.all(...args) as R;
            } catch (e) {
                const err = e as Error;
                // better-sqlite3 insists that queries that return no data use run(), but Bun doesn't care.
                if (err?.message?.includes?.('This statement does not return data.')) return [] as unknown as R;
                else throw err;
            }
        })();
        let i = -1;
        for (const wrap of wrapList) {
            i++;
            if (Buffer.isBuffer(wrap)) wrapList[i] = new Uint8Array(wrap.buffer, wrap.byteOffset, wrap.byteLength) as unknown as R;
            if (typeof wrap === 'object' && wrap && 'blobby' in wrap && Buffer.isBuffer(wrap.blobby))
                wrap.blobby = new Uint8Array(wrap.blobby.buffer, wrap.blobby.byteOffset, wrap.blobby.byteLength) as unknown as R;
        }
        return wrapList;
    }
    values(...args: unknown[]): ReturnType<bun_sqlite.Statement['values']> {
        return this.all(...args).map((value) => Object.values(value));
    }
    run(...args: unknown[]): void {
        this.#ASSERT_NOT_FINALIZED();
        if (args.length === 0) return void this.#raw.run();
        const arg0 = args[0];
        if (args.length === 1 && typeof arg0 === 'string' && !arg0.trim()) throw new Error('Query contained no valid SQL statement; likely empty query.');
        if (!Array.isArray(arg0) && (!arg0 || typeof arg0 !== 'object' || ArrayBuffer.isView(arg0))) return void this.#raw.run(args);
        for (const arg of args) {
            if (typeof arg === 'object' && arg && !Array.isArray(arg)) {
                const keys = Object.keys(arg);
                for (const key of keys) {
                    if (key[0] === '$' || key[0] === '@') {
                        const value = Reflect.get(arg, key);
                        Reflect.deleteProperty(arg, key);
                        Reflect.set(arg, key.slice(1), value);
                    }
                }
            }
        }
        this.#raw.run(...args);
    }
    get columnNames() {
        this.#ASSERT_NOT_FINALIZED();
        return this.#raw.columns().map((column) => column.name);
    }
    get paramsCount() {
        this.#ASSERT_NOT_FINALIZED();
        return this.#boundParams.length;
    }
    #ASSERT_NOT_FINALIZED() {
        if (this.isFinalized) throw new Error('Statement is finalized');
    }
    finalize() {
        this.isFinalized = true;
    }
}
Statement satisfies typeof bun_sqlite.Statement;

let cachedCount = Symbol.for('Bun.Database.cache.count');

export class Database implements bun_sqlite.Database {
    constructor(filenameGiven: string | Buffer = ':memory:', options?: ConstructorParameters<typeof bun_sqlite.Database>[1]) {
        if (typeof options === 'number') {
            const flags: number = options;
            options = {};
            options.readonly = !!(flags & constants.SQLITE_OPEN_READONLY);
            options.create = !!(flags & constants.SQLITE_OPEN_CREATE);
            options.readwrite = !!(flags & constants.SQLITE_OPEN_READWRITE);
        }
        options ??= { readonly: false, create: true, readwrite: true };

        if (typeof filenameGiven !== 'string') {
            if (ArrayBuffer.isView(filenameGiven)) {
                this.#handle = Database.#deserialize(filenameGiven, options.readonly);
                this.filename = ':memory:';
                return;
            }
            throw new TypeError(`Expected 'filename' to be a string, got '${typeof filenameGiven}'`);
        }

        const filename = filenameGiven.trim() || ':memory:';

        const anonymous = filename === '' || filename === ':memory:';
        if (anonymous && options.readonly) throw new Error('Cannot open an anonymous database in read-only mode.');

        this.#handle = bsqlite3(anonymous ? ':memory:' : filename, options);
        this.filename = filename;
    }

    #handle;
    #handleID: number = crypto.getRandomValues(new Uint32Array(1))[0];
    #cachedQueriesKeys: string[] = [];
    #cachedQueriesLengths: number[] = [];
    #cachedQueriesValues: Statement[] = [];
    filename;

    get handle() {
        return this.#handleID;
    }

    get inTransaction() {
        return this.#handle.inTransaction;
    }

    static open(filename?: string, options?: number | { readonly?: boolean, create?: boolean, readwrite?: boolean; }) {
        return new Database(filename, options);
    }

    loadExtension(ext?: string, entryPoint?: string) {
        return this.#handle.loadExtension(ext!);
    }

    serialize(optionalName: string) {
        return this.#handle.serialize({ attached: optionalName || 'main' });
    }

    static #deserialize(serialized: Buffer, readonly = false) {
        return new bsqlite3(serialized, { readonly });
    }

    static deserialize(serialized: Buffer, isReadOnly = false) {
        return new Database(serialized, isReadOnly ? constants.SQLITE_OPEN_READONLY : 0);
    }

    static setCustomSQLite(path: string) {
        if (process.platform === 'darwin') throw new Error('Not implemented');
        else return false;
    }

    close() {
        this.clearQueryCache();
        return this.#handle.close();
    }
    clearQueryCache() {
        for (let item of this.#cachedQueriesValues) {
            item.finalize();
        }
        this.#cachedQueriesKeys.length = 0;
        this.#cachedQueriesValues.length = 0;
        this.#cachedQueriesLengths.length = 0;
    }

    run<ParamsType extends bun_sqlite.SQLQueryBindings[]>(sqlQuery: string, ...bindings: ParamsType[]): void {
        if (!sqlQuery.trim()) throw new Error('Query contained no valid SQL statement; likely empty query.');
        if (bindings.length === 0) return void this.#handle.exec(sqlQuery);
        const prepared = this.prepare(sqlQuery, bindings as unknown as bun_sqlite.SQLQueryBindings[]);
        prepared.run();
    }

    exec<ParamsType extends bun_sqlite.SQLQueryBindings[]>(sqlQuery: string, ...bindings: ParamsType[]): void {
        this.run(sqlQuery, ...bindings);
    }

    prepare(query: string, params: Parameters<bun_sqlite.Database['prepare']>[1]) {
        return new Statement(this.#handle.prepare(query), params);
    }

    static MAX_QUERY_CACHE_SIZE = 20;

    get [cachedCount]() {
        return this.#cachedQueriesKeys.length;
    }

    query(query: string) {
        if (typeof query !== 'string') {
            throw new TypeError(`Expected 'query' to be a string, got '${typeof query}'`);
        }

        if (query.length === 0) {
            throw new Error('SQL query cannot be empty.');
        }

        const willCache = this.#cachedQueriesKeys.length < Database.MAX_QUERY_CACHE_SIZE;

        let index = this.#cachedQueriesLengths.indexOf(query.length);
        while (index !== -1) {
            if (this.#cachedQueriesKeys[index] !== query) {
                index = this.#cachedQueriesLengths.indexOf(query.length, index + 1);
                continue;
            }

            let stmt = this.#cachedQueriesValues[index];
            if (stmt.isFinalized) {
                return (this.#cachedQueriesValues[index] = this.prepare(
                    query,
                    undefined,
                ));
            }
            return stmt;
        }

        let stmt = this.prepare(query, undefined);

        if (willCache) {
            this.#cachedQueriesKeys.push(query);
            this.#cachedQueriesLengths.push(query.length);
            this.#cachedQueriesValues.push(stmt);
        }

        return stmt;
    }

    transaction(fn: Parameters<bun_sqlite.Database['transaction']>[0]): ReturnType<bun_sqlite.Database['transaction']> {
        if (typeof fn !== 'function') throw new TypeError('Expected first argument to be a function');

        const db = this;
        const controller = getController(db);

        const properties = {
            default: { value: wrapTransaction(fn, db, controller.default) },
            deferred: { value: wrapTransaction(fn, db, controller.deferred) },
            immediate: { value: wrapTransaction(fn, db, controller.immediate) },
            exclusive: { value: wrapTransaction(fn, db, controller.exclusive) },
            database: { value: this, enumerable: true },
        };

        Object.defineProperties(properties.default.value, properties);
        Object.defineProperties(properties.deferred.value, properties);
        Object.defineProperties(properties.immediate.value, properties);
        Object.defineProperties(properties.exclusive.value, properties);
        // @ts-expect-error cast
        return properties.default.value;
    }
}

const getController = (db: Database) => {
    let controller = (controllers ||= new WeakMap()).get(db);
    if (!controller) {
        const shared = {
            commit: db.prepare('COMMIT', undefined),
            rollback: db.prepare('ROLLBACK', undefined),
            savepoint: db.prepare('SAVEPOINT `\t_bs3.\t`', undefined),
            release: db.prepare('RELEASE `\t_bs3.\t`', undefined),
            rollbackTo: db.prepare('ROLLBACK TO `\t_bs3.\t`', undefined),
        };

        controllers.set(
            db,
            (controller = {
                default: Object.assign({ begin: db.prepare('BEGIN', undefined) }, shared),
                deferred: Object.assign({ begin: db.prepare('BEGIN DEFERRED', undefined) }, shared),
                immediate: Object.assign({ begin: db.prepare('BEGIN IMMEDIATE', undefined) }, shared),
                exclusive: Object.assign({ begin: db.prepare('BEGIN EXCLUSIVE', undefined) }, shared),
            }),
        );
    }
    return controller;
};

const wrapTransaction = (fn: Function, db: Database, { begin, commit, rollback, savepoint, release, rollbackTo }: any) =>
    function transaction(this: any, ...args: any[]) {
        let before, after, undo;
        if (db.inTransaction) {
            before = savepoint;
            after = release;
            undo = rollbackTo;
        } else {
            before = begin;
            after = commit;
            undo = rollback;
        }
        try {
            before.run();
            const result = fn.apply(this, args);
            after.run();
            return result;
        } catch (ex) {
            if (db.inTransaction) {
                undo.run();
                if (undo !== rollback) after.run();
            }
            throw ex;
        }
    };

export default {
    Database,
    Statement,
    constants,
    default: Database,
    get native() {
        throw new Error('bun-polyfills does not polyfill exposed native sqlite bindings.');
    },
} satisfies typeof bun_sqlite;
