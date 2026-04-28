// Hardcoded module "node:sqlite"
// https://nodejs.org/api/sqlite.html
//
// This is implemented as a wrapper over bun:sqlite. Not all of Node.js's
// node:sqlite surface area is covered yet (UDFs, sessions, backup), but the
// core DatabaseSync / StatementSync API used by most applications works.

const { Database: BunDatabase } = require("../bun/sqlite.ts");
const { validateObject, validateBoolean, validateString, validateInt32 } = require("internal/validators");
const { throwNotImplemented } = require("internal/shared");

const ObjectKeys = Object.keys;
const ArrayIsArray = Array.isArray;
const ArrayBufferIsView = ArrayBuffer.isView;
const SymbolDispose = Symbol.dispose;

const kDatabase = Symbol("kDatabase");
const kStatement = Symbol("kStatement");

function isURL(value) {
  return (
    value != null && typeof value === "object" && typeof value.href === "string" && typeof value.protocol === "string"
  );
}

function ERR_INVALID_STATE(message) {
  return $ERR_INVALID_STATE(message);
}

function ERR_ILLEGAL_CONSTRUCTOR() {
  const err = new TypeError("Illegal constructor");
  err.code = "ERR_ILLEGAL_CONSTRUCTOR";
  return err;
}

// Validate a single bindable value and throw a Node.js-compatible error if it
// cannot be bound. bun:sqlite already rejects most of these, but with
// different error codes/messages than Node.js.
function validateBindValue(value, position) {
  const t = typeof value;
  if (value === null || t === "number" || t === "string") return value;
  if (t === "bigint") {
    // Node.js uses int64_t range.
    if (value > 9223372036854775807n || value < -9223372036854775808n) {
      const err = new RangeError("BigInt value is too large to bind");
      err.code = "ERR_INVALID_ARG_VALUE";
      throw err;
    }
    return value;
  }
  if (ArrayBufferIsView(value)) return value;
  const err = new TypeError(`Provided value cannot be bound to SQLite parameter ${position}`);
  err.code = "ERR_INVALID_ARG_TYPE";
  throw err;
}

// Normalise the variadic argument list Node.js accepts into the single
// positional array (plus optional named-parameter object) that bun:sqlite
// expects. Node.js accepts at most one leading object of named parameters
// followed by zero or more anonymous parameters.
function bindParameters(statement, args) {
  const paramsCount = statement.paramsCount;
  let named;
  let anonStart = 0;
  if (
    args.length > 0 &&
    args[0] !== null &&
    typeof args[0] === "object" &&
    !ArrayBufferIsView(args[0]) &&
    !ArrayIsArray(args[0])
  ) {
    named = args[0];
    anonStart = 1;
  }

  if (named !== undefined) {
    const normalized = { __proto__: null };
    const keys = ObjectKeys(named);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const value = validateBindValue(named[key], i + 1);
      normalized[key] = value;
    }
    // Include any trailing anonymous parameters as positional entries on the
    // object using 1-based integer keys (bun:sqlite supports this).
    let pos = 1;
    for (let i = anonStart; i < args.length; i++, pos++) {
      normalized[pos] = validateBindValue(args[i], pos);
    }
    return normalized;
  }

  // All anonymous. Build a positional array and pad with nulls so that
  // re-running a statement with fewer arguments clears previous bindings.
  const positional = new Array(paramsCount).fill(null);
  let pos = 0;
  for (let i = anonStart; i < args.length; i++, pos++) {
    positional[pos] = validateBindValue(args[i], pos + 1);
  }
  return positional;
}

class StatementSync {
  #db;
  #stmt;
  #readBigInts = false;
  #returnArrays = false;

  constructor(token, db, stmt) {
    if (token !== kStatement) {
      throw ERR_ILLEGAL_CONSTRUCTOR();
    }
    this.#db = db;
    this.#stmt = stmt;
  }

  #checkOpen() {
    if (!this.#db[kDatabase]) {
      throw ERR_INVALID_STATE("statement has been finalized");
    }
  }

  run(...args) {
    this.#checkOpen();
    const bound = bindParameters(this.#stmt, args);
    if (ArrayIsArray(bound)) {
      if (this.#stmt.paramsCount === 0) {
        return this.#stmt.run();
      }
      return this.#stmt.run(bound);
    }
    return this.#stmt.run(bound);
  }

  get(...args) {
    this.#checkOpen();
    const bound = bindParameters(this.#stmt, args);
    let row;
    if (ArrayIsArray(bound)) {
      row = this.#stmt.paramsCount === 0 ? this.#stmt.get() : this.#stmt.get(bound);
    } else {
      row = this.#stmt.get(bound);
    }
    if (this.#returnArrays && row != null) {
      const names = this.#stmt.columnNames;
      const out = new Array(names.length);
      for (let i = 0; i < names.length; i++) out[i] = row[names[i]];
      return out;
    }
    return row ?? undefined;
  }

  all(...args) {
    this.#checkOpen();
    const bound = bindParameters(this.#stmt, args);
    let rows;
    if (ArrayIsArray(bound)) {
      rows = this.#stmt.paramsCount === 0 ? this.#stmt.all() : this.#stmt.all(bound);
    } else {
      rows = this.#stmt.all(bound);
    }
    if (this.#returnArrays && rows.length > 0) {
      const names = this.#stmt.columnNames;
      return rows.map(row => {
        const out = new Array(names.length);
        for (let i = 0; i < names.length; i++) out[i] = row[names[i]];
        return out;
      });
    }
    return rows;
  }

  *iterate(...args) {
    this.#checkOpen();
    const bound = bindParameters(this.#stmt, args);
    if (ArrayIsArray(bound)) {
      if (this.#stmt.paramsCount === 0) {
        yield* this.#stmt.iterate();
      } else {
        yield* this.#stmt.iterate(bound);
      }
    } else {
      yield* this.#stmt.iterate(bound);
    }
  }

  columns() {
    this.#checkOpen();
    const names = this.#stmt.columnNames;
    const decls = this.#stmt.declaredTypes;
    const out = new Array(names.length);
    for (let i = 0; i < names.length; i++) {
      out[i] = {
        __proto__: null,
        column: null,
        database: null,
        name: names[i],
        table: null,
        type: decls?.[i] ?? null,
      };
    }
    return out;
  }

  get sourceSQL() {
    return this.#stmt.toString();
  }

  get expandedSQL() {
    return this.#stmt.toString();
  }

  setReadBigInts(enabled) {
    validateBoolean(enabled, "readBigInts");
    this.#readBigInts = enabled;
    this.#stmt.safeIntegers(enabled);
    return undefined;
  }

  setReturnArrays(enabled) {
    validateBoolean(enabled, "returnArrays");
    this.#returnArrays = enabled;
    return undefined;
  }

  setAllowBareNamedParameters(enabled) {
    validateBoolean(enabled, "allowBareNamedParameters");
    return undefined;
  }

  setAllowUnknownNamedParameters(enabled) {
    validateBoolean(enabled, "allowUnknownNamedParameters");
    return undefined;
  }
}

class DatabaseSync {
  #path;
  #options;
  #db = null;
  #statements = new Set();
  #allowExtension = false;

  constructor(path, options) {
    if (typeof path !== "string" && !$isTypedArrayView(path) && !isURL(path)) {
      throw $ERR_INVALID_ARG_TYPE("path", ["string", "Buffer", "URL"], path);
    }

    let open = true;
    let readOnly = false;
    let enableForeignKeyConstraints = true;
    let enableDoubleQuotedStringLiterals = false;
    let allowExtension = false;
    let timeout = 0;

    if (options !== undefined) {
      validateObject(options, "options");
      if (options.open !== undefined) {
        validateBoolean(options.open, "options.open");
        open = options.open;
      }
      if (options.readOnly !== undefined) {
        validateBoolean(options.readOnly, "options.readOnly");
        readOnly = options.readOnly;
      }
      if (options.enableForeignKeyConstraints !== undefined) {
        validateBoolean(options.enableForeignKeyConstraints, "options.enableForeignKeyConstraints");
        enableForeignKeyConstraints = options.enableForeignKeyConstraints;
      }
      if (options.enableDoubleQuotedStringLiterals !== undefined) {
        validateBoolean(options.enableDoubleQuotedStringLiterals, "options.enableDoubleQuotedStringLiterals");
        enableDoubleQuotedStringLiterals = options.enableDoubleQuotedStringLiterals;
      }
      if (options.allowExtension !== undefined) {
        validateBoolean(options.allowExtension, "options.allowExtension");
        allowExtension = options.allowExtension;
      }
      if (options.timeout !== undefined) {
        validateInt32(options.timeout, "options.timeout");
        timeout = options.timeout;
      }
    }

    if (isURL(path)) {
      path = Bun.fileURLToPath(path);
    }

    this.#path = path;
    this.#allowExtension = allowExtension;
    this.#options = {
      readOnly,
      enableForeignKeyConstraints,
      enableDoubleQuotedStringLiterals,
      timeout,
    };

    if (open) {
      this.#open();
    }
  }

  #open() {
    const { readOnly, enableForeignKeyConstraints, timeout } = this.#options;
    const db = new BunDatabase(this.#path, readOnly ? { readonly: true } : { readwrite: true, create: true });
    this.#db = db;
    if (enableForeignKeyConstraints) {
      db.run("PRAGMA foreign_keys = ON");
    } else {
      db.run("PRAGMA foreign_keys = OFF");
    }
    if (timeout > 0) {
      db.run(`PRAGMA busy_timeout = ${timeout | 0}`);
    }
  }

  get [kDatabase]() {
    return this.#db;
  }

  get isOpen() {
    return this.#db !== null;
  }

  get isTransaction() {
    if (this.#db === null) return false;
    return this.#db.inTransaction;
  }

  open() {
    if (this.#db !== null) {
      throw ERR_INVALID_STATE("database is already open");
    }
    this.#open();
    return undefined;
  }

  close() {
    if (this.#db === null) {
      throw ERR_INVALID_STATE("database is not open");
    }
    for (const stmt of this.#statements) {
      try {
        stmt.finalize();
      } catch {}
    }
    this.#statements.clear();
    this.#db.close();
    this.#db = null;
    return undefined;
  }

  exec(sql) {
    if (this.#db === null) {
      throw ERR_INVALID_STATE("database is not open");
    }
    validateString(sql, "sql");
    this.#db.run(sql);
    return undefined;
  }

  prepare(sql, options) {
    if (this.#db === null) {
      throw ERR_INVALID_STATE("database is not open");
    }
    validateString(sql, "sql");
    if (options !== undefined) {
      validateObject(options, "options");
    }
    const bunStmt = this.#db.prepare(sql);
    this.#statements.add(bunStmt);
    const stmt = new StatementSync(kStatement, this, bunStmt);
    if (options?.readBigInts !== undefined) {
      stmt.setReadBigInts(options.readBigInts);
    }
    if (options?.returnArrays !== undefined) {
      stmt.setReturnArrays(options.returnArrays);
    }
    return stmt;
  }

  enableLoadExtension(allow) {
    validateBoolean(allow, "allow");
    if (allow && !this.#allowExtension) {
      throw ERR_INVALID_STATE("Cannot enable extension loading because it was disabled at database creation time");
    }
    return undefined;
  }

  loadExtension(path, entryPoint) {
    if (this.#db === null) {
      throw ERR_INVALID_STATE("database is not open");
    }
    if (!this.#allowExtension) {
      throw ERR_INVALID_STATE("extension loading is not enabled for this database");
    }
    validateString(path, "path");
    return this.#db.loadExtension(path, entryPoint);
  }

  location(dbName) {
    if (this.#db === null) {
      throw ERR_INVALID_STATE("database is not open");
    }
    const filename = this.#db.filename;
    if (filename === ":memory:" || filename === "") return null;
    return filename;
  }

  function(_name, _optionsOrFn, _maybeFn) {
    throwNotImplemented("node:sqlite DatabaseSync.prototype.function");
  }

  aggregate(_name, _options) {
    throwNotImplemented("node:sqlite DatabaseSync.prototype.aggregate");
  }

  createSession(_options) {
    throwNotImplemented("node:sqlite DatabaseSync.prototype.createSession");
  }

  applyChangeset(_changeset, _options) {
    throwNotImplemented("node:sqlite DatabaseSync.prototype.applyChangeset");
  }

  [SymbolDispose]() {
    try {
      this.close();
    } catch {}
  }
}

function backup(_sourceDb, _path, _options) {
  throwNotImplemented("node:sqlite backup");
}

const constants = {
  __proto__: null,
  SQLITE_CHANGESET_OMIT: 0,
  SQLITE_CHANGESET_REPLACE: 1,
  SQLITE_CHANGESET_ABORT: 2,
  SQLITE_CHANGESET_DATA: 1,
  SQLITE_CHANGESET_NOTFOUND: 2,
  SQLITE_CHANGESET_CONFLICT: 3,
  SQLITE_CHANGESET_CONSTRAINT: 4,
  SQLITE_CHANGESET_FOREIGN_KEY: 5,
};

export default {
  DatabaseSync,
  StatementSync,
  backup,
  constants,
};
