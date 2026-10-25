// Hardcoded module "sqlite"
import type * as SqliteTypes from "bun:sqlite";

const kSafeIntegersFlag = 1 << 1;
const kStrictFlag = 1 << 2;
const kOwnedByDatabaseFlag = 1 << 3;
const kPrepareOwned = Symbol("prepareOwned");

const enum UpdateHook {
  SQLITE_DELETE = 9,
  SQLITE_INSERT = 18,
  SQLITE_UPDATE = 23,
}

const defineProperties = Object.defineProperties;
const toStringTag = Symbol.toStringTag;
const isTypedArray = ArrayBuffer.isView;
const isInteger = Number.isInteger;

const { 0: SQL, 1: internalFieldTuple }: { 0: CppSQL; 1: TODO } = $cpp(
  "JSSQLStatement.cpp",
  "createJSSQLStatementConstructor",
);

function createChangesObject() {
  return {
    changes: $getInternalField(internalFieldTuple, 0),
    lastInsertRowid: $getInternalField(internalFieldTuple, 1),
  };
}

const constants = {
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

  SQLITE_DESERIALIZE_READONLY: 0x00000004 /* Ok for sqlite3_deserialize() */,

  SQLITE_FCNTL_LOCKSTATE: 1,
  SQLITE_FCNTL_GET_LOCKPROXYFILE: 2,
  SQLITE_FCNTL_SET_LOCKPROXYFILE: 3,
  SQLITE_FCNTL_LAST_ERRNO: 4,
  SQLITE_FCNTL_SIZE_HINT: 5,
  SQLITE_FCNTL_CHUNK_SIZE: 6,
  SQLITE_FCNTL_FILE_POINTER: 7,
  SQLITE_FCNTL_SYNC_OMITTED: 8,
  SQLITE_FCNTL_WIN32_AV_RETRY: 9,
  SQLITE_FCNTL_PERSIST_WAL: 10,
  SQLITE_FCNTL_OVERWRITE: 11,
  SQLITE_FCNTL_VFSNAME: 12,
  SQLITE_FCNTL_POWERSAFE_OVERWRITE: 13,
  SQLITE_FCNTL_PRAGMA: 14,
  SQLITE_FCNTL_BUSYHANDLER: 15,
  SQLITE_FCNTL_TEMPFILENAME: 16,
  SQLITE_FCNTL_MMAP_SIZE: 18,
  SQLITE_FCNTL_TRACE: 19,
  SQLITE_FCNTL_HAS_MOVED: 20,
  SQLITE_FCNTL_SYNC: 21,
  SQLITE_FCNTL_COMMIT_PHASETWO: 22,
  SQLITE_FCNTL_WIN32_SET_HANDLE: 23,
  SQLITE_FCNTL_WAL_BLOCK: 24,
  SQLITE_FCNTL_ZIPVFS: 25,
  SQLITE_FCNTL_RBU: 26,
  SQLITE_FCNTL_VFS_POINTER: 27,
  SQLITE_FCNTL_JOURNAL_POINTER: 28,
  SQLITE_FCNTL_WIN32_GET_HANDLE: 29,
  SQLITE_FCNTL_PDB: 30,
  SQLITE_FCNTL_BEGIN_ATOMIC_WRITE: 31,
  SQLITE_FCNTL_COMMIT_ATOMIC_WRITE: 32,
  SQLITE_FCNTL_ROLLBACK_ATOMIC_WRITE: 33,
  SQLITE_FCNTL_LOCK_TIMEOUT: 34,
  SQLITE_FCNTL_DATA_VERSION: 35,
  SQLITE_FCNTL_SIZE_LIMIT: 36,
  SQLITE_FCNTL_CKPT_DONE: 37,
  SQLITE_FCNTL_RESERVE_BYTES: 38,
  SQLITE_FCNTL_CKPT_START: 39,
  SQLITE_FCNTL_EXTERNAL_READER: 40,
  SQLITE_FCNTL_CKSM_FILE: 41,
  SQLITE_FCNTL_RESET_CACHE: 42,
};

// This is interface is the JS equivalent of what JSSQLStatement.cpp defines
interface CppSQLStatement {
  run: (...args: TODO[]) => TODO;
  get: (...args: TODO[]) => TODO;
  all: (...args: TODO[]) => TODO;
  iterate: (...args: TODO[]) => TODO;
  // The next row of the run `runCount`, or null after the last one.
  iterateNext: (runCount: number) => TODO;
  iterateEnd: (runCount: number) => void;
  runCount: number;
  as: (...args: TODO[]) => TODO;
  values: (...args: TODO[]) => TODO;
  raw: (...args: TODO[]) => TODO;
  finalize: (...args: TODO[]) => TODO;
  toString: (...args: TODO[]) => TODO;
  isFinalized: boolean;
  readonly: boolean;
  columns: string[];
  columnsCount: number;
  paramsCount: number;
  columnTypes: SqliteTypes.Statement["columnTypes"];
  declaredTypes: (string | null)[];
  safeIntegers: boolean;
  // For the SQLite adapter of Bun.sql: makes the key of a row object from the name of a column.
  $setColumnNameTransform(transform: ((name: string) => string) | null | undefined): void;
}

interface CppSQL {
  open(filename: string, flags: number): TODO;
  handleNumber(handle: TODO): number;
  isInTransaction(handle: TODO): boolean;
  loadExtension(handle: TODO, name: string, entryPoint: string): void;
  serialize(handle: TODO, name: string): Buffer;
  deserialize(serialized: NodeJS.TypedArray | ArrayBufferLike, deserializeFlags: number): TODO;
  fcntl(handle: TODO, zDbName: string | null, op: number, arg: TODO): number;
  close(handle: TODO, throwOnError: boolean): void;
  setCustomSQLite(path: string): boolean;
  run(handle: TODO, internalFlags: number, internalFieldTuple: TODO, query: string, params: TODO[]): void;
  // With `step`: an aggregate, and `functionOrStart` is its `start`.
  defineFunction(
    handle: TODO,
    name: string,
    argumentCount: number,
    flags: number,
    safeIntegers: boolean,
    functionOrStart: TODO,
    step?: Function,
    inverse?: Function,
    result?: Function,
  ): void;
  updateHook(handle: TODO, operation: UpdateHook): TODO;
  setUpdateHook(handle: TODO, operation: UpdateHook, hook: TODO, database: Database, internalFlags: number): void;
  prepare(
    handle: TODO,
    query: string,
    params: TODO[] | undefined,
    flags: number,
    internalFlags: number,
  ): CppSQLStatement;
}

interface TransactionFunction<A extends any[], T> {
  (...args: A): T;
  deferred: (...args: A) => T;
  immediate: (...args: A) => T;
  exclusive: (...args: A) => T;
}

function booleanOption(options, key: string, fallback = false): boolean {
  const value = options[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new TypeError(`Expected the "${key}" option to be a boolean`);
  return value;
}

function functionOption(options, key: string): Function | undefined {
  const value = options[key];
  if (value == null) return undefined;
  if (typeof value !== "function") throw new TypeError(`Expected the "${key}" option to be a function`);
  return value;
}

function parameterCount(fn: Function): number {
  const length = fn.length;
  if (!isInteger(length) || length < 0) throw new TypeError("Expected function.length to be a positive integer");
  return length;
}

// SQLITE_DETERMINISTIC | SQLITE_DIRECTONLY
function functionFlags(options): number {
  return (booleanOption(options, "deterministic") ? 0x800 : 0) | (booleanOption(options, "directOnly") ? 0x80000 : 0);
}
let controllers: WeakMap<Database, any> | undefined;

class Statement<ReturnType = unknown, ParamsType extends SqliteTypes.SQLQueryBindings[] = any[]> {
  constructor(raw: CppSQLStatement) {
    this.#raw = raw;

    switch (raw.paramsCount) {
      case 0: {
        this.get = this.#getNoArgs;
        this.all = this.#allNoArgs;
        this.iterate = this.#iterateNoArgs;
        this.values = this.#valuesNoArgs;
        this.raw = this.#rawNoArgs;
        this.run = this.#runNoArgs;
        break;
      }
      default: {
        this.get = this.#get;
        this.all = this.#all;
        this.iterate = this.#iterate;
        this.values = this.#values;
        this.raw = this.#rawValues;
        this.run = this.#run;
        break;
      }
    }
  }

  #raw: CppSQLStatement;

  get: SqliteTypes.Statement<ReturnType, ParamsType>["get"];
  all: SqliteTypes.Statement<ReturnType, ParamsType>["all"];
  iterate: SqliteTypes.Statement<ReturnType, ParamsType>["iterate"];
  values: SqliteTypes.Statement<ReturnType, ParamsType>["values"];
  raw: SqliteTypes.Statement<ReturnType, ParamsType>["raw"];
  run: SqliteTypes.Statement<ReturnType, ParamsType>["run"];
  get isFinalized() {
    return this.#raw.isFinalized;
  }

  toJSON() {
    return {
      sql: this.native.toString(),
      isFinalized: this.isFinalized,
      paramsCount: this.paramsCount,
      columnNames: this.columnNames,
    };
  }

  get [toStringTag]() {
    return `"${this.native.toString()}"`;
  }

  toString() {
    return this.native.toString();
  }

  get native() {
    return this.#raw;
  }

  #getNoArgs() {
    return this.#raw.get();
  }

  #allNoArgs() {
    return this.#raw.all();
  }

  #iterateNoArgs() {
    return this.#iterate();
  }

  #valuesNoArgs() {
    return this.#raw.values();
  }

  #rawNoArgs() {
    return this.#raw.raw();
  }

  #runNoArgs() {
    this.#raw.run(internalFieldTuple);

    return createChangesObject();
  }

  safeIntegers(updatedValue: boolean): this;
  safeIntegers(): boolean;
  safeIntegers(updatedValue?: boolean) {
    if (updatedValue !== undefined) {
      this.#raw.safeIntegers = !!updatedValue;
      return this;
    }

    return this.#raw.safeIntegers;
  }

  as<T = unknown>(ClassType: new (...args: any[]) => T): Statement<T, ParamsType>;
  as(ClassType: new (...args: any[]) => unknown): Statement<unknown, ParamsType> {
    this.#raw.as(ClassType);

    return this;
  }

  // The native methods take the array of arguments: SQLiteBinder::bind decides what they are.
  #get(...args) {
    return this.#raw.get(args);
  }

  #all(...args) {
    return this.#raw.all(args);
  }

  *#iterate(...args) {
    const raw = this.#raw;
    let row = raw.iterate(args);
    const run = raw.runCount;
    try {
      for (; row; row = raw.iterateNext(run)) yield row;
    } finally {
      raw.iterateEnd(run);
    }
  }

  #values(...args) {
    return this.#raw.values(args);
  }

  #rawValues(...args) {
    return this.#raw.raw(args);
  }

  #run(...args) {
    this.#raw.run(internalFieldTuple, args);
    return createChangesObject();
  }

  get columnNames() {
    return this.#raw.columns;
  }

  get columnTypes() {
    return this.#raw.columnTypes;
  }

  get declaredTypes() {
    return this.#raw.declaredTypes;
  }

  get paramsCount() {
    return this.#raw.paramsCount;
  }

  get reader() {
    return this.#raw.columnsCount > 0;
  }

  get readonly() {
    return this.#raw.readonly;
  }

  finalize(...args) {
    return this.#raw.finalize(...args);
  }

  [Symbol.iterator]() {
    return this.#iterate();
  }

  [Symbol.dispose]() {
    if (!this.isFinalized) {
      this.finalize();
    }
  }
}

const cachedCount = Symbol.for("Bun.Database.cache.count");

class Database implements SqliteTypes.Database {
  declare exec: Database["run"];

  constructor(
    filenameGiven: string | undefined | NodeJS.TypedArray | Buffer<ArrayBufferLike>,
    options?: SqliteTypes.DatabaseOptions | number,
  ) {
    if (typeof filenameGiven === "undefined") {
    } else if (typeof filenameGiven !== "string") {
      if (isTypedArray(filenameGiven)) {
        let deserializeFlags = 0;
        if (options && typeof options === "object") {
          if (options.strict) {
            this.#internalFlags |= kStrictFlag;
          }

          if (options.safeIntegers) {
            this.#internalFlags |= kSafeIntegersFlag;
          }

          if (options.readonly) {
            deserializeFlags |= constants.SQLITE_DESERIALIZE_READONLY;
          }
        }

        this.#handle = SQL.deserialize(filenameGiven, deserializeFlags);
        this.filename = ":memory:";

        return;
      }

      throw new TypeError(`Expected 'filename' to be a string, got '${typeof filenameGiven}'`);
    }

    var filename = typeof filenameGiven === "string" ? filenameGiven.trim() : ":memory:";
    var flags = constants.SQLITE_OPEN_READWRITE | constants.SQLITE_OPEN_CREATE;
    if (typeof options === "object" && options) {
      if ("readOnly" in options) throw new TypeError('Misspelled option "readOnly" should be "readonly"');

      // `undefined` is an option that was not given. Any other falsy value turns the option off.
      const { readonly, create, readwrite } = options;
      if (readonly || (readwrite !== undefined && !readwrite)) {
        if (create || readwrite) {
          throw new TypeError(
            'A read-only database ("readonly: true" or "readwrite: false") cannot have "create: true" or "readwrite: true"',
          );
        }
        flags = constants.SQLITE_OPEN_READONLY;
      } else if (!create && (create !== undefined || readwrite)) {
        flags = constants.SQLITE_OPEN_READWRITE;
      }

      if (options.safeIntegers) {
        this.#internalFlags |= kSafeIntegersFlag;
      }

      if (options.strict) {
        this.#internalFlags |= kStrictFlag;
      }
    } else if (typeof options === "number") {
      flags = options;
    }

    const anonymous = filename === "" || filename === ":memory:";
    if (anonymous && (flags & constants.SQLITE_OPEN_READONLY) !== 0) {
      throw new Error("Cannot open an anonymous database in read-only mode.");
    }

    this.#handle = SQL.open(anonymous ? ":memory:" : filename, flags);
    this.filename = filename;
  }

  #internalFlags = 0;
  #handle;
  #queryCache: Map<string, Statement> = new Map();
  filename;
  get handle() {
    return SQL.handleNumber(this.#handle);
  }

  get inTransaction() {
    return SQL.isInTransaction(this.#handle);
  }

  static open(filename, options) {
    return new Database(filename, options);
  }

  loadExtension(name, entryPoint) {
    return SQL.loadExtension(this.#handle, name, entryPoint);
  }

  serialize(optionalName?: string) {
    return SQL.serialize(this.#handle, optionalName || "main");
  }

  static deserialize(
    serialized: NodeJS.TypedArray | ArrayBufferLike,
    options: boolean | { readonly?: boolean; strict?: boolean; safeIntegers?: boolean } = false,
  ) {
    const bytes: NodeJS.TypedArray = require("node:util/types").isAnyArrayBuffer(serialized)
      ? new Uint8Array(serialized as ArrayBufferLike)
      : (serialized as NodeJS.TypedArray);
    if (!isTypedArray(bytes)) {
      throw new TypeError(`Expected 'serialized' to be a TypedArray or ArrayBuffer, got '${typeof serialized}'`);
    }
    if (typeof options === "boolean") {
      // Maintain backward compatibility with existing API
      return new Database(bytes, { readonly: options });
    } else if (options && typeof options === "object") {
      return new Database(bytes, options);
    } else {
      return new Database(bytes, 0);
    }
  }

  [Symbol.dispose]() {
    this.close(true);
  }

  static setCustomSQLite(path) {
    return SQL.setCustomSQLite(path);
  }

  fileControl(zDbName, op?, arg?) {
    if (typeof zDbName === "string" || arguments.length > 2) return SQL.fcntl(this.#handle, zDbName, op, arg);
    return SQL.fcntl(this.#handle, null, zDbName, op);
  }

  close(throwOnError = false) {
    // native close finalizes every kOwnedByDatabaseFlag statement (query cache + transaction controller)
    this.#queryCache.$clear();
    controllers?.delete(this);
    return SQL.close(this.#handle, throwOnError);
  }
  clearQueryCache() {
    this.#queryCache.$forEach(stmt => stmt.finalize());
    this.#queryCache.$clear();
  }

  run(query, ...params) {
    SQL.run(this.#handle, this.#internalFlags, internalFieldTuple, query, params);
    return createChangesObject();
  }

  function(name, options, fn?) {
    if (typeof options === "function") {
      fn = options;
      options = undefined;
    }
    options ??= {};
    if (typeof name !== "string") throw new TypeError("Expected first argument to be a string");
    if (typeof fn !== "function") throw new TypeError("Expected last argument to be a function");
    if (typeof options !== "object") throw new TypeError("Expected second argument to be an options object");
    if (!name) throw new TypeError("User-defined function name cannot be an empty string");

    const safeIntegers = booleanOption(options, "safeIntegers", (this.#internalFlags & kSafeIntegersFlag) !== 0);
    const flags = functionFlags(options);
    const argumentCount = booleanOption(options, "varargs") ? -1 : parameterCount(fn);
    SQL.defineFunction(this.#handle, name, argumentCount, flags, safeIntegers, fn);
    return this;
  }

  aggregate(name, options) {
    if (typeof name !== "string") throw new TypeError("Expected first argument to be a string");
    if (typeof options !== "object" || !options)
      throw new TypeError("Expected second argument to be an options object");
    if (!name) throw new TypeError("User-defined function name cannot be an empty string");

    const start = options.start;
    const step = functionOption(options, "step");
    if (!step) throw new TypeError('Missing required option "step"');
    const inverse = functionOption(options, "inverse");
    const result = functionOption(options, "result");
    const safeIntegers = booleanOption(options, "safeIntegers", (this.#internalFlags & kSafeIntegersFlag) !== 0);
    const flags = functionFlags(options);
    // The first parameter of `step` and `inverse` is the accumulator.
    const argumentCount = booleanOption(options, "varargs")
      ? -1
      : Math.max(parameterCount(step), inverse ? parameterCount(inverse) : 0, 1) - 1;
    SQL.defineFunction(this.#handle, name, argumentCount, flags, safeIntegers, start ?? null, step, inverse, result);
    return this;
  }

  get onInsert() {
    return SQL.updateHook(this.#handle, UpdateHook.SQLITE_INSERT);
  }
  set onInsert(hook) {
    SQL.setUpdateHook(this.#handle, UpdateHook.SQLITE_INSERT, hook, this, this.#internalFlags);
  }

  get onUpdate() {
    return SQL.updateHook(this.#handle, UpdateHook.SQLITE_UPDATE);
  }
  set onUpdate(hook) {
    SQL.setUpdateHook(this.#handle, UpdateHook.SQLITE_UPDATE, hook, this, this.#internalFlags);
  }

  get onDelete() {
    return SQL.updateHook(this.#handle, UpdateHook.SQLITE_DELETE);
  }
  set onDelete(hook) {
    SQL.setUpdateHook(this.#handle, UpdateHook.SQLITE_DELETE, hook, this, this.#internalFlags);
  }

  prepare<ReturnType, ParamsType extends SqliteTypes.SQLQueryBindings | SqliteTypes.SQLQueryBindings[]>(
    query: string,
    params?: ParamsType,
    flags: number = 0,
  ) {
    return new Statement<ReturnType, ParamsType extends any[] ? ParamsType : [ParamsType]>(
      SQL.prepare(this.#handle, query, params == null ? undefined : [params], flags || 0, this.#internalFlags),
    );
  }

  [kPrepareOwned](query: string, flags: number) {
    return new Statement(
      SQL.prepare(this.#handle, query, undefined, flags, this.#internalFlags | kOwnedByDatabaseFlag),
    );
  }

  static MAX_QUERY_CACHE_SIZE = 20;

  get [cachedCount]() {
    return this.#queryCache.$size;
  }

  query(query) {
    if (typeof query !== "string") {
      throw new TypeError(`Expected 'query' to be a string, got '${typeof query}'`);
    }

    if (query.length === 0) {
      throw new Error("SQL query cannot be empty.");
    }

    const cache = this.#queryCache;
    let stmt = cache.$get(query);
    if (stmt !== undefined) {
      // LRU: re-insert so the most recently used key is last
      cache.$delete(query);
      if (stmt.isFinalized) stmt = this[kPrepareOwned](query, constants.SQLITE_PREPARE_PERSISTENT);
      cache.$set(query, stmt);
      return stmt;
    }

    stmt = this[kPrepareOwned](query, constants.SQLITE_PREPARE_PERSISTENT);
    const max = Database.MAX_QUERY_CACHE_SIZE;
    // A compiled statement is several times the size of its text.
    if (max > 0 && query.length <= 64 * 1024) {
      // evicted statements stay usable; close() still finalizes them via kOwnedByDatabaseFlag
      if (cache.$size >= max) cache.$delete(cache.$keys().next().value);
      cache.$set(query, stmt);
    }
    return stmt;
  }

  // Code for transactions is largely copied from better-sqlite3
  // https://github.com/JoshuaWise/better-sqlite3/blob/master/lib/methods/transaction.js
  // thank you @JoshuaWise!
  transaction<A extends any[], T>(fn: (...args: A) => T, self?) {
    if (typeof fn !== "function") throw new TypeError("Expected first argument to be a function");

    const db = this;
    const controller = getController(db, self);

    // Each version of the transaction function has these same properties
    const properties = {
      default: { value: wrapTransaction(fn, db, controller.default) },
      deferred: { value: wrapTransaction(fn, db, controller.deferred) },
      immediate: {
        value: wrapTransaction(fn, db, controller.immediate),
      },
      exclusive: {
        value: wrapTransaction(fn, db, controller.exclusive),
      },
      database: { value: this, enumerable: true },
    };

    defineProperties(properties.default.value, properties);
    defineProperties(properties.deferred.value, properties);
    defineProperties(properties.immediate.value, properties);
    defineProperties(properties.exclusive.value, properties);

    // Return the default version of the transaction function
    return properties.default.value as TransactionFunction<A, T>;
  }
}

Database.prototype.exec = Database.prototype.run;
// How a library tells the SQLite modules of the runtimes apart. node:sqlite has it too.
Database.prototype[Symbol.for("sqlite-type")] = "bun:sqlite";

// Return the database's cached transaction controller, or create a new one
const getController = (db, _self) => {
  let controller = (controllers ||= new WeakMap()).get(db);
  if (!controller) {
    const shared = {
      commit: db[kPrepareOwned]("COMMIT", 0),
      rollback: db[kPrepareOwned]("ROLLBACK", 0),
      savepoint: db[kPrepareOwned]("SAVEPOINT `\t_bs3.\t`", 0),
      release: db[kPrepareOwned]("RELEASE `\t_bs3.\t`", 0),
      rollbackTo: db[kPrepareOwned]("ROLLBACK TO `\t_bs3.\t`", 0),
    };

    controllers.set(
      db,
      (controller = {
        default: Object.assign({ begin: db[kPrepareOwned]("BEGIN", 0) }, shared),
        deferred: Object.assign({ begin: db[kPrepareOwned]("BEGIN DEFERRED", 0) }, shared),
        immediate: Object.assign({ begin: db[kPrepareOwned]("BEGIN IMMEDIATE", 0) }, shared),
        exclusive: Object.assign({ begin: db[kPrepareOwned]("BEGIN EXCLUSIVE", 0) }, shared),
      }),
    );
  }
  return controller;
};

function undoTransaction(db, undo, after, rollback) {
  if (db.inTransaction) {
    undo.run();
    if (undo !== rollback) after.run();
  }
}

// Return a new transaction function by wrapping the given function
const wrapTransaction = (fn, db, { begin, commit, rollback, savepoint, release, rollbackTo }) =>
  function transaction(this, ...args) {
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
      const result = fn.$apply(this, args);
      // 2 is rejected: an async function that threw before its first `await` returns this instead of throwing.
      if ($isPromise(result) && $peekPromiseStatus(result) === 2) {
        undoTransaction(db, undo, after, rollback);
      } else {
        after.run();
      }
      return result;
    } catch (ex) {
      undoTransaction(db, undo, after, rollback);
      throw ex;
    }
  };

// This class is never actually thrown
// so we implement instanceof so that it could theoretically be caught
class SQLiteError extends Error {
  static [Symbol.hasInstance](instance) {
    return instance?.name === "SQLiteError";
  }

  constructor() {
    super();
    throw new Error("SQLiteError can only be constructed by bun:sqlite");
  }
}

export default {
  __esModule: true,
  Database,
  Statement,
  constants,
  default: Database,
  SQLiteError,
};
