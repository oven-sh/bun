// Hardcoded module "sqlite"
import type * as SqliteTypes from "bun:sqlite";

const kSafeIntegersFlag = 1 << 1;
const kStrictFlag = 1 << 2;

var defineProperties = Object.defineProperties;
var toStringTag = Symbol.toStringTag;
var isArray = Array.isArray;
var isTypedArray = ArrayBuffer.isView;

let internalFieldTuple;

function initializeSQL() {
  ({ 0: SQL, 1: internalFieldTuple } = $cpp("JSSQLStatement.cpp", "createJSSQLStatementConstructor"));
}

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

var SQL;

var controllers;

class Statement {
  constructor(raw) {
    this.#raw = raw;

    switch (raw.paramsCount) {
      case 0: {
        this.get = this.#getNoArgs;
        this.all = this.#allNoArgs;
        this.iterate = this.#iterateNoArgs;
        this.values = this.#valuesNoArgs;
        this.run = this.#runNoArgs;
        break;
      }
      default: {
        this.get = this.#get;
        this.all = this.#all;
        this.iterate = this.#iterate;
        this.values = this.#values;
        this.run = this.#run;
        break;
      }
    }
  }

  #raw;

  get: SqliteTypes.Statement["get"];
  all: SqliteTypes.Statement["all"];
  iterate: SqliteTypes.Statement["iterate"];
  values: SqliteTypes.Statement["values"];
  run: SqliteTypes.Statement["run"];
  isFinalized = false;

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

  *#iterateNoArgs() {
    for (let res = this.#raw.iterate(); res; res = this.#raw.iterate()) {
      yield res;
    }
  }

  #valuesNoArgs() {
    return this.#raw.values();
  }

  #runNoArgs() {
    this.#raw.run(internalFieldTuple);

    return createChangesObject();
  }

  safeIntegers(updatedValue?: boolean) {
    if (updatedValue !== undefined) {
      this.#raw.safeIntegers = !!updatedValue;
      return this;
    }

    return this.#raw.safeIntegers;
  }

  as(ClassType: any) {
    this.#raw.as(ClassType);

    return this;
  }

  // eslint-disable-next-line no-unused-private-class-members
  #get(...args) {
    if (args.length === 0) return this.#getNoArgs();
    var arg0 = args[0];
    // ["foo"] => ["foo"]
    // ("foo") => ["foo"]
    // (Uint8Array(1024)) => [Uint8Array]
    // (123) => [123]
    return !isArray(arg0) && (!arg0 || typeof arg0 !== "object" || isTypedArray(arg0))
      ? this.#raw.get(args)
      : this.#raw.get(...args);
  }

  // eslint-disable-next-line no-unused-private-class-members
  #all(...args) {
    if (args.length === 0) return this.#allNoArgs();
    var arg0 = args[0];
    // ["foo"] => ["foo"]
    // ("foo") => ["foo"]
    // (Uint8Array(1024)) => [Uint8Array]
    // (123) => [123]
    return !isArray(arg0) && (!arg0 || typeof arg0 !== "object" || isTypedArray(arg0))
      ? this.#raw.all(args)
      : this.#raw.all(...args);
  }

  // eslint-disable-next-line no-unused-private-class-members
  *#iterate(...args) {
    if (args.length === 0) return yield* this.#iterateNoArgs();
    var arg0 = args[0];
    // ["foo"] => ["foo"]
    // ("foo") => ["foo"]
    // (Uint8Array(1024)) => [Uint8Array]
    // (123) => [123]
    let res =
      !isArray(arg0) && (!arg0 || typeof arg0 !== "object" || isTypedArray(arg0))
        ? this.#raw.iterate(args)
        : this.#raw.iterate(...args);
    for (; res; res = this.#raw.iterate()) {
      yield res;
    }
  }

  // eslint-disable-next-line no-unused-private-class-members
  #values(...args) {
    if (args.length === 0) return this.#valuesNoArgs();
    var arg0 = args[0];
    // ["foo"] => ["foo"]
    // ("foo") => ["foo"]
    // (Uint8Array(1024)) => [Uint8Array]
    // (123) => [123]
    return !isArray(arg0) && (!arg0 || typeof arg0 !== "object" || isTypedArray(arg0))
      ? this.#raw.values(args)
      : this.#raw.values(...args);
  }

  // eslint-disable-next-line no-unused-private-class-members
  #run(...args) {
    if (args.length === 0) {
      this.#runNoArgs();
      return createChangesObject();
    }

    var arg0 = args[0];

    !isArray(arg0) && (!arg0 || typeof arg0 !== "object" || isTypedArray(arg0))
      ? this.#raw.run(internalFieldTuple, args)
      : this.#raw.run(internalFieldTuple, ...args);

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

  finalize(...args) {
    this.isFinalized = true;
    return this.#raw.finalize(...args);
  }

  *[Symbol.iterator]() {
    yield* this.#iterateNoArgs();
  }

  [Symbol.dispose]() {
    if (!this.isFinalized) {
      this.finalize();
    }
  }
}

var cachedCount = Symbol.for("Bun.Database.cache.count");
class Database {
  constructor(filenameGiven, options) {
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

        this.#handle = Database.#deserialize(filenameGiven, this.#internalFlags, deserializeFlags);
        this.filename = ":memory:";

        return;
      }

      throw new TypeError(`Expected 'filename' to be a string, got '${typeof filenameGiven}'`);
    }

    var filename = typeof filenameGiven === "string" ? filenameGiven.trim() : ":memory:";
    var flags = constants.SQLITE_OPEN_READWRITE | constants.SQLITE_OPEN_CREATE;
    if (typeof options === "object" && options) {
      flags = 0;

      if (options.readonly) {
        flags = constants.SQLITE_OPEN_READONLY;
      }

      if ("readOnly" in options) throw new TypeError('Misspelled option "readOnly" should be "readonly"');

      if (options.create) {
        flags = constants.SQLITE_OPEN_READWRITE | constants.SQLITE_OPEN_CREATE;
      }

      if (options.readwrite) {
        flags |= constants.SQLITE_OPEN_READWRITE;
      }

      if ("strict" in options || "safeIntegers" in options) {
        if (options.safeIntegers) {
          this.#internalFlags |= kSafeIntegersFlag;
        }

        if (options.strict) {
          this.#internalFlags |= kStrictFlag;
        }

        // If they only set strict: true, reset it back.
        if (flags === 0) {
          flags = constants.SQLITE_OPEN_READWRITE | constants.SQLITE_OPEN_CREATE;
        }
      }
    } else if (typeof options === "number") {
      flags = options;
    }

    const anonymous = filename === "" || filename === ":memory:";
    if (anonymous && (flags & constants.SQLITE_OPEN_READONLY) !== 0) {
      throw new Error("Cannot open an anonymous database in read-only mode.");
    }

    if (!SQL) {
      initializeSQL();
    }

    this.#handle = SQL.open(anonymous ? ":memory:" : filename, flags, this);
    this.filename = filename;
  }

  #internalFlags = 0;
  #handle;
  #cachedQueriesKeys: string[] = [];
  #cachedQueriesLengths: number[] = [];
  #cachedQueriesValues: Statement[] = [];
  filename;
  #hasClosed = false;
  get handle() {
    return this.#handle;
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

  serialize(optionalName) {
    return SQL.serialize(this.#handle, optionalName || "main");
  }

  static #deserialize(serialized, openFlags, deserializeFlags) {
    if (!SQL) {
      initializeSQL();
    }

    return SQL.deserialize(serialized, openFlags, deserializeFlags);
  }

  static deserialize(
    serialized,
    options: boolean | { readonly?: boolean; strict?: boolean; safeIntegers?: boolean } = false,
  ) {
    if (typeof options === "boolean") {
      // Maintain backward compatibility with existing API
      return new Database(serialized, { readonly: options });
    } else if (options && typeof options === "object") {
      return new Database(serialized, options);
    } else {
      return new Database(serialized, 0);
    }
  }

  [Symbol.dispose]() {
    if (!this.#hasClosed) {
      this.close(true);
    }
  }

  static setCustomSQLite(path) {
    if (!SQL) {
      initializeSQL();
    }

    return SQL.setCustomSQLite(path);
  }

  fileControl(_cmd, _arg) {
    const handle = this.#handle;

    if (arguments.length <= 2) {
      return SQL.fcntl(handle, null, arguments[0], arguments[1]);
    }

    return SQL.fcntl(handle, ...arguments);
  }

  close(throwOnError = false) {
    this.clearQueryCache();
    this.#hasClosed = true;
    return SQL.close(this.#handle, throwOnError);
  }
  clearQueryCache() {
    for (let item of this.#cachedQueriesValues) {
      item?.finalize?.();
    }
    this.#cachedQueriesKeys.length = 0;
    this.#cachedQueriesValues.length = 0;
    this.#cachedQueriesLengths.length = 0;
  }

  run(query, ...params) {
    if (params.length === 0) {
      SQL.run(this.#handle, this.#internalFlags, internalFieldTuple, query);
      return createChangesObject();
    }

    var arg0 = params[0];
    !isArray(arg0) && (!arg0 || typeof arg0 !== "object" || isTypedArray(arg0))
      ? SQL.run(this.#handle, this.#internalFlags, internalFieldTuple, query, params)
      : SQL.run(this.#handle, this.#internalFlags, internalFieldTuple, query, ...params);

    return createChangesObject();
  }

  prepare(query, params, flags) {
    return new Statement(SQL.prepare(this.#handle, query, params, flags || 0, this.#internalFlags));
  }

  static MAX_QUERY_CACHE_SIZE = 20;

  get [cachedCount]() {
    return this.#cachedQueriesKeys.length;
  }

  query(query) {
    if (typeof query !== "string") {
      throw new TypeError(`Expected 'query' to be a string, got '${typeof query}'`);
    }

    if (query.length === 0) {
      throw new Error("SQL query cannot be empty.");
    }

    const willCache = this.#cachedQueriesKeys.length < Database.MAX_QUERY_CACHE_SIZE;

    // this list should be pretty small
    let index = this.#cachedQueriesLengths.indexOf(query.length);
    while (index !== -1) {
      if (this.#cachedQueriesKeys[index] !== query) {
        index = this.#cachedQueriesLengths.indexOf(query.length, index + 1);
        continue;
      }

      const stmt = this.#cachedQueriesValues[index];
      if (stmt.isFinalized) {
        return (this.#cachedQueriesValues[index] = this.prepare(
          query,
          undefined,
          willCache ? constants.SQLITE_PREPARE_PERSISTENT : 0,
        ));
      }
      return stmt;
    }

    var stmt = this.prepare(query, undefined, willCache ? constants.SQLITE_PREPARE_PERSISTENT : 0);

    if (willCache) {
      this.#cachedQueriesKeys.push(query);
      this.#cachedQueriesLengths.push(query.length);
      this.#cachedQueriesValues.push(stmt);
    }

    return stmt;
  }

  // Code for transactions is largely copied from better-sqlite3
  // https://github.com/JoshuaWise/better-sqlite3/blob/master/lib/methods/transaction.js
  // thank you @JoshuaWise!
  transaction(fn, self) {
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
    return properties.default.value;
  }
}

// @ts-expect-error
Database.prototype.exec = Database.prototype.run;

// Return the database's cached transaction controller, or create a new one
const getController = (db, _self) => {
  let controller = (controllers ||= new WeakMap()).get(db);
  if (!controller) {
    const shared = {
      commit: db.prepare("COMMIT", undefined, 0),
      rollback: db.prepare("ROLLBACK", undefined, 0),
      savepoint: db.prepare("SAVEPOINT `\t_bs3.\t`", undefined, 0),
      release: db.prepare("RELEASE `\t_bs3.\t`", undefined, 0),
      rollbackTo: db.prepare("ROLLBACK TO `\t_bs3.\t`", undefined, 0),
    };

    controllers.set(
      db,
      (controller = {
        default: Object.assign({ begin: db.prepare("BEGIN", undefined, 0) }, shared),
        deferred: Object.assign({ begin: db.prepare("BEGIN DEFERRED", undefined, 0) }, shared),
        immediate: Object.assign({ begin: db.prepare("BEGIN IMMEDIATE", undefined, 0) }, shared),
        exclusive: Object.assign({ begin: db.prepare("BEGIN EXCLUSIVE", undefined, 0) }, shared),
      }),
    );
  }
  return controller;
};

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
