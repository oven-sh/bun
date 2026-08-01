// Hardcoded module "better-sqlite3": the real package is a V8-API addon Bun cannot dlopen, so wrap bun:sqlite. API: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
const { Database: BunDatabase, SQLiteError } = require("bun:sqlite");
const { existsSync } = require("node:fs");
const { dirname, resolve } = require("node:path");
const { inspect } = require("node:util");
const { throwNotImplemented } = require("internal/shared");

const nodejsUtilInspectCustom = Symbol.for("nodejs.util.inspect.custom");
const notImplementedExtra = "This module is backed by bun:sqlite; see https://bun.sh/docs/api/sqlite";

function getBooleanOption(options, key) {
  let value = false;
  if (key in options && typeof (value = options[key]) !== "boolean") {
    throw new TypeError(`Expected the "${key}" option to be a boolean`);
  }
  return value;
}

// better-sqlite3 Statement: .raw()/.pluck()/.expand()/.bind() are chainable mode setters, not one-shot getters.
class Statement {
  #stmt;
  #db;
  #source;
  #verbose;
  #raw = false;
  #pluck = false;
  #expand = false;
  #bound: any[] | null = null;
  #safeIntegers;

  constructor(stmt, database, source, safeIntegers, verbose) {
    this.#stmt = stmt;
    this.#db = database;
    this.#source = source;
    this.#safeIntegers = safeIntegers;
    this.#verbose = verbose;
  }

  #trace() {
    if (this.#verbose != null) this.#verbose.$call(this.#db, this.#source);
  }

  get database() {
    return this.#db;
  }
  get source() {
    return this.#source;
  }
  get reader() {
    return this.#stmt.native.columnsCount > 0;
  }
  get readonly() {
    return this.#stmt.native.readonly;
  }
  get busy() {
    return false;
  }

  #params(args: any[]) {
    if (this.#bound !== null) {
      if (args.length > 0) {
        throw new TypeError("This statement already has bound parameters");
      }
      return this.#bound;
    }
    return args;
  }

  #mapRow(row, names) {
    if (row === null || row === undefined) return undefined;
    if (this.#pluck) return row[0];
    if (this.#raw) return row;
    const obj = {};
    for (let i = 0; i < names.length; i++) obj[names[i]] = row[i];
    return obj;
  }

  run(...args) {
    this.#trace();
    return this.#stmt.run.$apply(this.#stmt, this.#params(args));
  }

  get(...args) {
    this.#trace();
    const params = this.#params(args);
    if (this.#raw || this.#pluck || this.#expand) {
      const rows = this.#stmt.values.$apply(this.#stmt, params);
      const first = rows.length > 0 ? rows[0] : undefined;
      if (first === undefined) return undefined;
      if (this.#expand) return this.#expandRow(first);
      return this.#mapRow(first, this.#stmt.columnNames);
    }
    const row = this.#stmt.get.$apply(this.#stmt, params);
    return row === null ? undefined : row;
  }

  all(...args) {
    this.#trace();
    const params = this.#params(args);
    if (this.#raw || this.#pluck || this.#expand) {
      const rows = this.#stmt.values.$apply(this.#stmt, params);
      if (this.#raw) return rows;
      const names = this.#stmt.columnNames;
      if (this.#pluck) {
        const out = $newArrayWithSize(rows.length);
        for (let i = 0; i < rows.length; i++) out[i] = rows[i][0];
        return out;
      }
      if (this.#expand) {
        const out = $newArrayWithSize(rows.length);
        for (let i = 0; i < rows.length; i++) out[i] = this.#expandRow(rows[i]);
        return out;
      }
      const out = $newArrayWithSize(rows.length);
      for (let i = 0; i < rows.length; i++) out[i] = this.#mapRow(rows[i], names);
      return out;
    }
    return this.#stmt.all.$apply(this.#stmt, params);
  }

  *iterate(...args) {
    this.#trace();
    const params = this.#params(args);
    if (this.#raw || this.#pluck || this.#expand) {
      const rows = this.#stmt.values.$apply(this.#stmt, params);
      const names = this.#stmt.columnNames;
      for (let i = 0; i < rows.length; i++) {
        if (this.#expand) yield this.#expandRow(rows[i]);
        else yield this.#mapRow(rows[i], names);
      }
      return;
    }
    yield* this.#stmt.iterate.$apply(this.#stmt, params);
  }

  #expandRow(row) {
    // sqlite3_column_table_name isn't exposed; group everything under "$" (better-sqlite3's no-table bucket).
    const names = this.#stmt.columnNames;
    const obj = { $: {} };
    for (let i = 0; i < names.length; i++) obj.$[names[i]] = row[i];
    return obj;
  }

  bind(...args) {
    if (this.#bound !== null) {
      throw new TypeError("The bind() method can only be invoked once per statement object");
    }
    this.#bound = args;
    return this;
  }

  pluck(toggle) {
    this.#pluck = toggle === undefined ? true : !!toggle;
    if (this.#pluck) this.#raw = this.#expand = false;
    return this;
  }

  raw(toggle) {
    this.#raw = toggle === undefined ? true : !!toggle;
    if (this.#raw) this.#pluck = this.#expand = false;
    return this;
  }

  expand(toggle) {
    this.#expand = toggle === undefined ? true : !!toggle;
    if (this.#expand) this.#pluck = this.#raw = false;
    return this;
  }

  safeIntegers(toggle) {
    this.#safeIntegers = toggle === undefined ? true : !!toggle;
    this.#stmt.safeIntegers(this.#safeIntegers);
    return this;
  }

  columns() {
    const names = this.#stmt.columnNames;
    let declared;
    try {
      declared = this.#stmt.declaredTypes;
    } catch {
      declared = null;
    }
    const out = $newArrayWithSize(names.length);
    for (let i = 0; i < names.length; i++) {
      out[i] = {
        name: names[i],
        column: null,
        table: null,
        database: null,
        type: declared ? (declared[i] ?? null) : null,
      };
    }
    return out;
  }

  [Symbol.iterator]() {
    return this.iterate();
  }
}

function Database(filenameGiven, options) {
  if (new.target == null) {
    return new Database(filenameGiven, options);
  }

  let buffer;
  if (Buffer.isBuffer(filenameGiven)) {
    buffer = filenameGiven;
    filenameGiven = ":memory:";
  }
  if (filenameGiven == null) filenameGiven = "";
  if (options == null) options = {};

  if (typeof filenameGiven !== "string") throw new TypeError("Expected first argument to be a string");
  if (typeof options !== "object") throw new TypeError("Expected second argument to be an options object");
  if ("readOnly" in options) throw new TypeError('Misspelled option "readOnly" should be "readonly"');
  if ("memory" in options)
    throw new TypeError('Option "memory" was removed in v7.0.0 (use ":memory:" filename instead)');

  const filename = filenameGiven.trim();
  const anonymous = filename === "" || filename === ":memory:";
  const readonly = getBooleanOption(options, "readonly");
  const fileMustExist = getBooleanOption(options, "fileMustExist");
  const timeout = "timeout" in options ? options.timeout : 5000;
  const verbose = "verbose" in options ? options.verbose : null;
  // nativeBinding is accepted and ignored: there is no native addon to load.
  const nativeBinding = "nativeBinding" in options ? options.nativeBinding : null;

  if (readonly && anonymous && !buffer) throw new TypeError("In-memory/temporary databases cannot be readonly");
  if (!Number.isInteger(timeout) || timeout < 0)
    throw new TypeError('Expected the "timeout" option to be a positive integer');
  if (timeout > 0x7fffffff) throw new RangeError('Option "timeout" cannot be greater than 2147483647');
  if (verbose != null && typeof verbose !== "function")
    throw new TypeError('Expected the "verbose" option to be a function');
  if (nativeBinding != null && typeof nativeBinding !== "string" && typeof nativeBinding !== "object")
    throw new TypeError('Expected the "nativeBinding" option to be a string or addon object');

  if (!anonymous && !existsSync(dirname(resolve(filename)))) {
    throw new TypeError("Cannot open database because the directory does not exist");
  }

  const openOptions = readonly
    ? { readonly: true, strict: true }
    : anonymous || !fileMustExist
      ? { create: true, strict: true }
      : { readwrite: true, strict: true };

  const db = buffer
    ? new BunDatabase(buffer, { readonly, strict: true })
    : new BunDatabase(anonymous ? ":memory:" : filename, openOptions);

  if (timeout > 0) db.run(`PRAGMA busy_timeout = ${timeout}`);

  let isOpen = true;
  let defaultSafeIntegers = false;

  Object.defineProperties(this, {
    name: { value: filenameGiven, enumerable: true },
    readonly: { value: readonly, enumerable: true },
    memory: { value: anonymous, enumerable: true },
    open: { get: () => isOpen, enumerable: true },
    inTransaction: { get: () => isOpen && db.inTransaction, enumerable: true },
  });

  this.prepare = function prepare(source) {
    if (typeof source !== "string") throw new TypeError("Expected first argument to be a string");
    const stmt = db.prepare(source, undefined, 0);
    if (defaultSafeIntegers) stmt.safeIntegers(true);
    return new Statement(stmt, this, source, defaultSafeIntegers, verbose);
  };

  this.exec = function exec(source) {
    if (typeof source !== "string") throw new TypeError("Expected first argument to be a string");
    if (verbose != null) verbose.$call(this, source);
    db.run(source);
    return this;
  };

  this.close = function close() {
    if (isOpen) {
      isOpen = false;
      db.close();
    }
    return this;
  };

  this.pragma = function pragma(source, opts) {
    if (opts == null) opts = {};
    if (typeof source !== "string") throw new TypeError("Expected first argument to be a string");
    if (typeof opts !== "object") throw new TypeError("Expected second argument to be an options object");
    const simple = getBooleanOption(opts, "simple");
    const stmt = db.prepare(`PRAGMA ${source}`, undefined, 0);
    try {
      if (simple) {
        const rows = stmt.values();
        return rows.length > 0 ? rows[0][0] : undefined;
      }
      return stmt.all();
    } finally {
      stmt.finalize();
    }
  };

  const self = this;
  // bun:sqlite's transaction() already returns a function with .deferred/.immediate/.exclusive.
  this.transaction = function transaction(fn) {
    return db.transaction(fn, self);
  };

  this.serialize = function serialize(opts) {
    const attached = opts && typeof opts === "object" ? opts.attached || "main" : "main";
    return db.serialize(attached);
  };

  this.loadExtension = function loadExtension(path, entryPoint) {
    db.loadExtension(path, entryPoint);
    return this;
  };

  this.defaultSafeIntegers = function (toggle) {
    defaultSafeIntegers = toggle === undefined ? true : !!toggle;
    return this;
  };

  this.unsafeMode = function unsafeMode(toggle) {
    if (toggle === undefined ? true : !!toggle) {
      throwNotImplemented("better-sqlite3 Database#unsafeMode(true)", 4290, notImplementedExtra);
    }
    return this;
  };

  this.backup = function backup() {
    throwNotImplemented("better-sqlite3 Database#backup()", 4290, notImplementedExtra);
  };
  this.function = function defineFunction() {
    throwNotImplemented("better-sqlite3 Database#function()", 4290, notImplementedExtra);
  };
  this.aggregate = function aggregate() {
    throwNotImplemented("better-sqlite3 Database#aggregate()", 4290, notImplementedExtra);
  };
  this.table = function table() {
    throwNotImplemented("better-sqlite3 Database#table()", 4290, notImplementedExtra);
  };

  this[nodejsUtilInspectCustom] = function (depth, opts) {
    return `Database ${inspect(
      {
        name: filenameGiven,
        open: isOpen,
        inTransaction: isOpen && db.inTransaction,
        readonly,
        memory: anonymous,
      },
      opts,
    )}`;
  };
}

class SqliteErrorClass extends Error {
  code;
  constructor(message, code) {
    if (typeof code !== "string") {
      throw new TypeError("Expected second argument to be a string");
    }
    super("" + message);
    this.code = code;
    Error.captureStackTrace(this, SqliteError);
  }
  get name() {
    return "SqliteError";
  }
}

function SqliteError(message, code) {
  return new SqliteErrorClass(message, code);
}
SqliteError.prototype = SqliteErrorClass.prototype;
// Let `err instanceof SqliteError` match bun:sqlite's `SQLiteError` (capital L) too.
Object.defineProperty(SqliteError, Symbol.hasInstance, {
  value(instance) {
    return (
      instance != null &&
      typeof instance === "object" &&
      (instance.name === "SqliteError" || instance.name === "SQLiteError" || SQLiteError[Symbol.hasInstance](instance))
    );
  },
});

Database.SqliteError = SqliteError;

export default Database;
