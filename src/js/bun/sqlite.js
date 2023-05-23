// Hardcoded module "sqlite"
var symbolFor = Symbol.for;

const lazy = globalThis[symbolFor("Bun.lazy")];
if (!lazy || typeof lazy !== "function") {
  throw new Error("Something went wrong while loading Bun. Expected 'Bun.lazy' to be defined.");
}

var defineProperties = Object.defineProperties;

var toStringTag = Symbol.toStringTag;
var apply = Function.prototype.apply;
var isArray = Array.isArray;
var isTypedArray = ArrayBuffer.isView;
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

var SQL;
var _SQL;

var controllers;

export class Statement {
  constructor(raw) {
    this.#raw = raw;

    switch (raw.paramsCount) {
      case 0: {
        this.get = this.#getNoArgs;
        this.all = this.#allNoArgs;
        this.values = this.#valuesNoArgs;
        this.run = this.#runNoArgs;
        break;
      }
      default: {
        this.get = this.#get;
        this.all = this.#all;
        this.values = this.#values;
        this.run = this.#run;
        break;
      }
    }
  }

  #raw;

  get;
  all;
  values;
  run;
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

  #valuesNoArgs() {
    return this.#raw.values();
  }

  #runNoArgs() {
    this.#raw.run();
  }

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

  #run(...args) {
    if (args.length === 0) return this.#runNoArgs();
    var arg0 = args[0];

    !isArray(arg0) && (!arg0 || typeof arg0 !== "object" || isTypedArray(arg0))
      ? this.#raw.run(args)
      : this.#raw.run(...args);
  }

  get columnNames() {
    return this.#raw.columns;
  }

  get paramsCount() {
    return this.#raw.paramsCount;
  }

  finalize(...args) {
    this.isFinalized = true;
    return this.#raw.finalize(...args);
  }
}

var cachedCount = symbolFor("Bun.Database.cache.count");
export class Database {
  constructor(filenameGiven, options) {
    if (typeof filenameGiven === "undefined") {
    } else if (typeof filenameGiven !== "string") {
      if (isTypedArray(filenameGiven)) {
        this.#handle = Database.deserialize(
          filenameGiven,
          typeof options === "object" && options
            ? !!options.readonly
            : ((options | 0) & constants.SQLITE_OPEN_READONLY) != 0,
        );
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
    } else if (typeof options === "number") {
      flags = options;
    }

    const anonymous = filename === "" || filename === ":memory:";
    if (anonymous && (flags & constants.SQLITE_OPEN_READONLY) !== 0) {
      throw new Error("Cannot open an anonymous database in read-only mode.");
    }

    if (!SQL) {
      _SQL = SQL = lazy("sqlite");
    }

    this.#handle = SQL.open(anonymous ? ":memory:" : filename, flags);
    this.filename = filename;
  }

  #handle;
  #cachedQueriesKeys = [];
  #cachedQueriesLengths = [];
  #cachedQueriesValues = [];
  filename;

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

  static deserialize(serialized, isReadOnly = false) {
    if (!SQL) {
      _SQL = SQL = lazy("sqlite");
    }

    return SQL.deserialize(serialized, isReadOnly);
  }

  static setCustomSQLite(path) {
    if (!SQL) {
      _SQL = SQL = lazy("sqlite");
    }

    return SQL.setCustomSQLite(path);
  }

  close() {
    this.clearQueryCache();
    return SQL.close(this.#handle);
  }
  clearQueryCache() {
    for (let item of this.#cachedQueriesValues) {
      item.finalize();
    }
    this.#cachedQueriesKeys.length = 0;
    this.#cachedQueriesValues.length = 0;
    this.#cachedQueriesLengths.length = 0;
  }

  run(query, ...params) {
    if (params.length === 0) {
      SQL.run(this.#handle, query);
      return;
    }

    var arg0 = params[0];
    return !isArray(arg0) && (!arg0 || typeof arg0 !== "object" || isTypedArray(arg0))
      ? SQL.run(this.#handle, query, params)
      : SQL.run(this.#handle, query, ...params);
  }

  prepare(query, params, flags) {
    return new Statement(SQL.prepare(this.#handle, query, params, flags || 0));
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

    // this list should be pretty small
    var index = this.#cachedQueriesLengths.indexOf(query.length);
    while (index !== -1) {
      if (this.#cachedQueriesKeys[index] !== query) {
        index = this.#cachedQueriesLengths.indexOf(query.length, index + 1);
        continue;
      }

      var stmt = this.#cachedQueriesValues[index];
      if (stmt.isFinalized) {
        return (this.#cachedQueriesValues[index] = this.prepare(
          query,
          undefined,
          willCache ? constants.SQLITE_PREPARE_PERSISTENT : 0,
        ));
      }
      return stmt;
    }

    const willCache = this.#cachedQueriesKeys.length < Database.MAX_QUERY_CACHE_SIZE;

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

Database.prototype.exec = Database.prototype.run;

// Return the database's cached transaction controller, or create a new one
const getController = (db, self) => {
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
  function transaction(...args) {
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

export { _SQL as native };
export { Database as default };
