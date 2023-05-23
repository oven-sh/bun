var symbolFor = Symbol.for, lazy = globalThis[symbolFor("Bun.lazy")];
if (!lazy || typeof lazy !== "function")
  throw new Error("Something went wrong while loading Bun. Expected 'Bun.lazy' to be defined.");
var defineProperties = Object.defineProperties, toStringTag = Symbol.toStringTag, apply = Function.prototype.apply, isArray = Array.isArray, isTypedArray = ArrayBuffer.isView, constants = {
  SQLITE_OPEN_READONLY: 1,
  SQLITE_OPEN_READWRITE: 2,
  SQLITE_OPEN_CREATE: 4,
  SQLITE_OPEN_DELETEONCLOSE: 8,
  SQLITE_OPEN_EXCLUSIVE: 16,
  SQLITE_OPEN_AUTOPROXY: 32,
  SQLITE_OPEN_URI: 64,
  SQLITE_OPEN_MEMORY: 128,
  SQLITE_OPEN_MAIN_DB: 256,
  SQLITE_OPEN_TEMP_DB: 512,
  SQLITE_OPEN_TRANSIENT_DB: 1024,
  SQLITE_OPEN_MAIN_JOURNAL: 2048,
  SQLITE_OPEN_TEMP_JOURNAL: 4096,
  SQLITE_OPEN_SUBJOURNAL: 8192,
  SQLITE_OPEN_SUPER_JOURNAL: 16384,
  SQLITE_OPEN_NOMUTEX: 32768,
  SQLITE_OPEN_FULLMUTEX: 65536,
  SQLITE_OPEN_SHAREDCACHE: 131072,
  SQLITE_OPEN_PRIVATECACHE: 262144,
  SQLITE_OPEN_WAL: 524288,
  SQLITE_OPEN_NOFOLLOW: 16777216,
  SQLITE_OPEN_EXRESCODE: 33554432,
  SQLITE_PREPARE_PERSISTENT: 1,
  SQLITE_PREPARE_NORMALIZE: 2,
  SQLITE_PREPARE_NO_VTAB: 4
}, SQL, _SQL, controllers;

class Statement {
  constructor(raw) {
    switch (this.#raw = raw, raw.paramsCount) {
      case 0: {
        this.get = this.#getNoArgs, this.all = this.#allNoArgs, this.values = this.#valuesNoArgs, this.run = this.#runNoArgs;
        break;
      }
      default: {
        this.get = this.#get, this.all = this.#all, this.values = this.#values, this.run = this.#run;
        break;
      }
    }
  }
  #raw;
  get;
  all;
  values;
  run;
  isFinalized = !1;
  toJSON() {
    return {
      sql: this.native.toString(),
      isFinalized: this.isFinalized,
      paramsCount: this.paramsCount,
      columnNames: this.columnNames
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
    if (args.length === 0)
      return this.#getNoArgs();
    var arg0 = args[0];
    return !isArray(arg0) && (!arg0 || typeof arg0 !== "object" || isTypedArray(arg0)) ? this.#raw.get(args) : this.#raw.get(...args);
  }
  #all(...args) {
    if (args.length === 0)
      return this.#allNoArgs();
    var arg0 = args[0];
    return !isArray(arg0) && (!arg0 || typeof arg0 !== "object" || isTypedArray(arg0)) ? this.#raw.all(args) : this.#raw.all(...args);
  }
  #values(...args) {
    if (args.length === 0)
      return this.#valuesNoArgs();
    var arg0 = args[0];
    return !isArray(arg0) && (!arg0 || typeof arg0 !== "object" || isTypedArray(arg0)) ? this.#raw.values(args) : this.#raw.values(...args);
  }
  #run(...args) {
    if (args.length === 0)
      return this.#runNoArgs();
    var arg0 = args[0];
    !isArray(arg0) && (!arg0 || typeof arg0 !== "object" || isTypedArray(arg0)) ? this.#raw.run(args) : this.#raw.run(...args);
  }
  get columnNames() {
    return this.#raw.columns;
  }
  get paramsCount() {
    return this.#raw.paramsCount;
  }
  finalize(...args) {
    return this.isFinalized = !0, this.#raw.finalize(...args);
  }
}
var cachedCount = symbolFor("Bun.Database.cache.count");

class Database {
  constructor(filenameGiven, options) {
    if (typeof filenameGiven === "undefined")
      ;
    else if (typeof filenameGiven !== "string") {
      if (isTypedArray(filenameGiven)) {
        this.#handle = Database.deserialize(filenameGiven, typeof options === "object" && options ? !!options.readonly : ((options | 0) & constants.SQLITE_OPEN_READONLY) != 0), this.filename = ":memory:";
        return;
      }
      throw new TypeError(`Expected 'filename' to be a string, got '${typeof filenameGiven}'`);
    }
    var filename = typeof filenameGiven === "string" ? filenameGiven.trim() : ":memory:", flags = constants.SQLITE_OPEN_READWRITE | constants.SQLITE_OPEN_CREATE;
    if (typeof options === "object" && options) {
      if (flags = 0, options.readonly)
        flags = constants.SQLITE_OPEN_READONLY;
      if ("readOnly" in options)
        throw new TypeError('Misspelled option "readOnly" should be "readonly"');
      if (options.create)
        flags = constants.SQLITE_OPEN_READWRITE | constants.SQLITE_OPEN_CREATE;
      if (options.readwrite)
        flags |= constants.SQLITE_OPEN_READWRITE;
    } else if (typeof options === "number")
      flags = options;
    const anonymous = filename === "" || filename === ":memory:";
    if (anonymous && (flags & constants.SQLITE_OPEN_READONLY) !== 0)
      throw new Error("Cannot open an anonymous database in read-only mode.");
    if (!SQL)
      _SQL = SQL = lazy("sqlite");
    this.#handle = SQL.open(anonymous ? ":memory:" : filename, flags), this.filename = filename;
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
  static deserialize(serialized, isReadOnly = !1) {
    if (!SQL)
      _SQL = SQL = lazy("sqlite");
    return SQL.deserialize(serialized, isReadOnly);
  }
  static setCustomSQLite(path) {
    if (!SQL)
      _SQL = SQL = lazy("sqlite");
    return SQL.setCustomSQLite(path);
  }
  close() {
    return this.clearQueryCache(), SQL.close(this.#handle);
  }
  clearQueryCache() {
    for (let item of this.#cachedQueriesValues)
      item.finalize();
    this.#cachedQueriesKeys.length = 0, this.#cachedQueriesValues.length = 0, this.#cachedQueriesLengths.length = 0;
  }
  run(query, ...params) {
    if (params.length === 0) {
      SQL.run(this.#handle, query);
      return;
    }
    var arg0 = params[0];
    return !isArray(arg0) && (!arg0 || typeof arg0 !== "object" || isTypedArray(arg0)) ? SQL.run(this.#handle, query, params) : SQL.run(this.#handle, query, ...params);
  }
  prepare(query, params, flags) {
    return new Statement(SQL.prepare(this.#handle, query, params, flags || 0));
  }
  static MAX_QUERY_CACHE_SIZE = 20;
  get [cachedCount]() {
    return this.#cachedQueriesKeys.length;
  }
  query(query) {
    if (typeof query !== "string")
      throw new TypeError(`Expected 'query' to be a string, got '${typeof query}'`);
    if (query.length === 0)
      throw new Error("SQL query cannot be empty.");
    var index = this.#cachedQueriesLengths.indexOf(query.length);
    while (index !== -1) {
      if (this.#cachedQueriesKeys[index] !== query) {
        index = this.#cachedQueriesLengths.indexOf(query.length, index + 1);
        continue;
      }
      var stmt = this.#cachedQueriesValues[index];
      if (stmt.isFinalized)
        return this.#cachedQueriesValues[index] = this.prepare(query, void 0, willCache ? constants.SQLITE_PREPARE_PERSISTENT : 0);
      return stmt;
    }
    const willCache = this.#cachedQueriesKeys.length < Database.MAX_QUERY_CACHE_SIZE;
    var stmt = this.prepare(query, void 0, willCache ? constants.SQLITE_PREPARE_PERSISTENT : 0);
    if (willCache)
      this.#cachedQueriesKeys.push(query), this.#cachedQueriesLengths.push(query.length), this.#cachedQueriesValues.push(stmt);
    return stmt;
  }
  transaction(fn, self) {
    if (typeof fn !== "function")
      throw new TypeError("Expected first argument to be a function");
    const db = this, controller = getController(db, self), properties = {
      default: { value: wrapTransaction(fn, db, controller.default) },
      deferred: { value: wrapTransaction(fn, db, controller.deferred) },
      immediate: {
        value: wrapTransaction(fn, db, controller.immediate)
      },
      exclusive: {
        value: wrapTransaction(fn, db, controller.exclusive)
      },
      database: { value: this, enumerable: !0 }
    };
    return defineProperties(properties.default.value, properties), defineProperties(properties.deferred.value, properties), defineProperties(properties.immediate.value, properties), defineProperties(properties.exclusive.value, properties), properties.default.value;
  }
}
Database.prototype.exec = Database.prototype.run;
var getController = (db, self) => {
  let controller = (controllers ||= new WeakMap).get(db);
  if (!controller) {
    const shared = {
      commit: db.prepare("COMMIT", void 0, 0),
      rollback: db.prepare("ROLLBACK", void 0, 0),
      savepoint: db.prepare("SAVEPOINT `\t_bs3.\t`", void 0, 0),
      release: db.prepare("RELEASE `\t_bs3.\t`", void 0, 0),
      rollbackTo: db.prepare("ROLLBACK TO `\t_bs3.\t`", void 0, 0)
    };
    controllers.set(db, controller = {
      default: Object.assign({ begin: db.prepare("BEGIN", void 0, 0) }, shared),
      deferred: Object.assign({ begin: db.prepare("BEGIN DEFERRED", void 0, 0) }, shared),
      immediate: Object.assign({ begin: db.prepare("BEGIN IMMEDIATE", void 0, 0) }, shared),
      exclusive: Object.assign({ begin: db.prepare("BEGIN EXCLUSIVE", void 0, 0) }, shared)
    });
  }
  return controller;
}, wrapTransaction = (fn, db, { begin, commit, rollback, savepoint, release, rollbackTo }) => function transaction(...args) {
  let before, after, undo;
  if (db.inTransaction)
    before = savepoint, after = release, undo = rollbackTo;
  else
    before = begin, after = commit, undo = rollback;
  try {
    before.run();
    const result = fn.apply(this, args);
    return after.run(), result;
  } catch (ex) {
    if (db.inTransaction) {
      if (undo.run(), undo !== rollback)
        after.run();
    }
    throw ex;
  }
};
export {
  _SQL as native,
  Database as default,
  constants,
  Statement,
  Database
};

//# debugId=75DCD993FF1B670964756e2164756e21
