// What a session stores: one SQLite file for its cookies, `localStorage` and IndexedDB.
const fs = require("node:fs");
const path = require("node:path");

class IndexedDatabase {
  meta: any;
  connections = new Set<object>();
  #sql;
  #origin: string;
  #name: string;
  #keys = new Map<number, string[]>();
  #transactions: any[] = [];
  #turns: ((done: () => void) => void)[] = [];
  #whenUnused: (() => void) | undefined;

  constructor(sql: any, origin: string, name: string) {
    this.#sql = sql;
    this.#origin = origin;
    this.#name = name = /^(?!")[ -~]*$/.test(name) ? name : JSON.stringify(name);
    const stored = sql.query("SELECT meta FROM idb WHERE origin = ? AND name = ?").get(origin, name);
    this.restoreMeta(stored?.meta ?? '{"version":0,"stores":{}}');
  }

  restoreMeta(json: string) {
    this.meta = JSON.parse(json, (key, value) =>
      key === "stores" || key === "indexes" ? Object.setPrototypeOf(value, null) : value,
    );
  }

  newTable(): number {
    return this.#sql.query("INSERT INTO idb_tables (origin) VALUES (?) RETURNING id").get(this.#origin).id;
  }

  keys(table: number) {
    let keys = this.#keys.$get(table);
    if (!keys) {
      const rows: Uint8Array[][] = this.#sql.query("SELECT key FROM idb_rows WHERE tab = ?").values(table);
      this.#keys.$set(table, (keys = rows.map(row => Buffer.from(row[0]).toString("utf16le")).sort()));
    }
    return keys;
  }

  value(table: number, key: string) {
    const query = this.#sql.query("SELECT value FROM idb_rows WHERE tab = ? AND key = ?");
    return query.get(table, Buffer.from(key, "utf16le")).value;
  }

  commit(cleared: number[], written: Map<number, Map<string, Uint8Array | null>>) {
    const sql = this.#sql;
    sql.transaction(() => {
      for (const table of cleared) sql.query("DELETE FROM idb_rows WHERE tab = ?").run(table);
      for (const [table, rows] of written) {
        for (const [key, value] of rows) {
          const bytes = Buffer.from(key, "utf16le");
          if (value) sql.query("INSERT OR REPLACE INTO idb_rows VALUES (?, ?, ?)").run(table, bytes, value);
          else sql.query("DELETE FROM idb_rows WHERE tab = ? AND key = ?").run(table, bytes);
        }
      }
      sql.query("INSERT OR REPLACE INTO idb VALUES (?, ?, ?)").run(this.#origin, this.#name, JSON.stringify(this.meta));
    })();
  }

  erase() {
    const sql = this.#sql;
    for (const connection of [...this.connections]) (connection as any).forceClose();
    sql.transaction(() => {
      for (const store of Object.values<any>(this.meta.stores)) {
        for (const { table } of [store, ...Object.values<any>(store.indexes)]) {
          sql.query("DELETE FROM idb_rows WHERE tab = ?").run(table);
          sql.query("DELETE FROM idb_tables WHERE id = ?").run(table);
        }
      }
      sql.query("DELETE FROM idb WHERE origin = ? AND name = ?").run(this.#origin, this.#name);
    })();
    this.#keys.$clear();
    this.restoreMeta('{"version":0,"stores":{}}');
  }

  /** Requests to open or to delete a database run one after the other. */
  takeTurn(run: (done: () => void) => void) {
    const done = () => {
      this.#turns.shift();
      this.#turns[0]?.(done);
    };
    if (this.#turns.push(run) === 1) run(done);
  }

  whenUnused(run: () => void) {
    this.#whenUnused = run;
    this.#checkUnused();
  }

  #checkUnused() {
    const run = this.#whenUnused;
    if (!run || this.connections.$size > 0 || this.#transactions.length > 0) return;
    this.#whenUnused = undefined;
    run();
  }

  disconnect(connection: object) {
    this.connections.$delete(connection);
    this.#checkUnused();
  }

  enqueue(transaction: any) {
    this.#transactions.push(transaction);
    this.#startTransactions();
  }

  dequeue(transaction: any) {
    if (!this.#transactions.includes(transaction)) return;
    this.#transactions.splice(this.#transactions.indexOf(transaction), 1);
    this.#startTransactions();
    this.#checkUnused();
  }

  abortTransactionsOf(connection: object) {
    for (const transaction of [...this.#transactions].reverse()) {
      if (transaction.connection === connection) transaction.abort(null);
    }
  }

  /** Those of a realm that has ended. */
  discardTransactions() {
    for (const transaction of [...this.#transactions].reverse()) transaction.discardIfGone();
  }

  #startTransactions() {
    this.#transactions.forEach((transaction, index) => {
      if (transaction.started) return;
      const waits = this.#transactions.slice(0, index).some(earlier => {
        if (earlier.mode === "readonly" && transaction.mode === "readonly") return false;
        return earlier.mode === "versionchange" || earlier.scope.some(name => transaction.scope.includes(name));
      });
      if (!waits) transaction.start();
    });
  }
}

const nameOf = (stored: string) => (stored[0] === '"' ? JSON.parse(stored) : stored);
const MAX_STORED = 5 << 20;

class LocalStorage {
  #size = 0;
  #items: Map<string, string>;
  #keys: string[] | undefined;
  #dirty = new Set<string>();
  #sql;
  #origin: string;

  constructor(sql: any, origin: string) {
    this.#sql = sql;
    this.#origin = origin;
    const text = (bytes: Uint8Array) => Buffer.from(bytes).toString("utf16le");
    const rows: Uint8Array[][] =
      sql?.query("SELECT key, value FROM local_storage WHERE origin = ?").values(origin) ?? [];
    this.#items = new Map(rows.map(([key, value]) => [text(key), text(value)]));
    for (const [key, value] of this.#items) this.#size += key.length + value.length;
  }

  copy() {
    const copy = new LocalStorage(null, this.#origin);
    for (const [key, value] of this.#items) copy.set(key, value);
    return copy;
  }

  keys() {
    return (this.#keys ??= [...this.#items.$keys()]);
  }

  get(key: string) {
    return this.#items.$get(key) ?? null;
  }

  #changed(key: string) {
    if (!this.#sql) return;
    if (this.#dirty.$size === 0) setTimeout(() => this.flush(), 500).unref();
    this.#dirty.$add(key);
  }

  #sizeWith(key: string, value: string | null) {
    const before = this.get(key);
    return (
      this.#size + (value === null ? 0 : key.length + value.length) - (before === null ? 0 : key.length + before.length)
    );
  }

  fits(key: string, value: string | null) {
    return this.#sizeWith(key, value) <= Math.max(MAX_STORED, this.#size);
  }

  /** False if that changes nothing. */
  set(key: string, value: string | null) {
    if (this.get(key) === value) return false;
    this.#size = this.#sizeWith(key, value);
    if (value === null || !this.#items.$has(key)) this.#keys = undefined;
    if (value === null) this.#items.$delete(key);
    else this.#items.$set(key, value);
    this.#changed(key);
    return true;
  }

  clear() {
    if (this.#items.$size === 0) return false;
    for (const key of this.#items.$keys()) this.#changed(key);
    this.#items.$clear();
    this.#keys = undefined;
    this.#size = 0;
    return true;
  }

  flush() {
    if (this.#dirty.$size === 0) return;
    const sql = this.#sql;
    sql.transaction(() => {
      for (const key of this.#dirty) {
        const [name, value] = [Buffer.from(key, "utf16le"), this.get(key)];
        if (value === null) sql.query("DELETE FROM local_storage WHERE origin = ? AND key = ?").run(this.#origin, name);
        else {
          const insert = sql.query("INSERT OR REPLACE INTO local_storage VALUES (?, ?, ?)");
          insert.run(this.#origin, name, Buffer.from(value, "utf16le"));
        }
      }
    })();
    this.#dirty.$clear();
  }
}

function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "bun-desktop-files-"));
  process.once("exit", () => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function open(file: string) {
  const sql = new (require("bun/sqlite").Database)(file);
  // This is the thread that draws, and an fsync can take seconds.
  sql.run(
    "PRAGMA journal_mode = WAL; PRAGMA synchronous = OFF; PRAGMA busy_timeout = 5000;" +
      "CREATE TABLE IF NOT EXISTS cookies (id TEXT PRIMARY KEY, cookie BLOB);" +
      "CREATE TABLE IF NOT EXISTS local_storage (origin TEXT, key BLOB, value BLOB, PRIMARY KEY (origin, key));" +
      "CREATE TABLE IF NOT EXISTS idb (origin TEXT, name TEXT, meta TEXT, PRIMARY KEY (origin, name));" +
      "CREATE TABLE IF NOT EXISTS idb_tables (id INTEGER PRIMARY KEY AUTOINCREMENT, origin TEXT);" +
      "CREATE TABLE IF NOT EXISTS idb_rows (tab INTEGER, key BLOB, value BLOB, PRIMARY KEY (tab, key));" +
      "CREATE TABLE IF NOT EXISTS caches (id INTEGER PRIMARY KEY AUTOINCREMENT, origin TEXT, name TEXT);" +
      "CREATE TABLE IF NOT EXISTS cache_entries (cache INTEGER, url TEXT, about TEXT, body BLOB);",
  );
  return sql;
}

class Storage {
  #directory: string | null;
  #sql: any;
  #files: string | undefined;
  #local = new Map<string, LocalStorage>();
  #databases = new Map<string, IndexedDatabase>();

  constructor(directory: string | null) {
    this.#directory = directory;
  }

  get sql() {
    if (this.#sql) return this.#sql;
    let file = ":memory:";
    if (this.#directory !== null) {
      fs.mkdirSync(this.#directory, { recursive: true, mode: 0o700 });
      file = path.join(this.#directory, "Web Storage.sqlite");
      fs.closeSync(fs.openSync(file, "a", 0o600));
    }
    try {
      return (this.#sql = open(file));
    } catch (error: any) {
      if (!/^SQLITE_(?:CORRUPT|NOTADB)/.test(error.code)) throw error;
      for (const suffix of ["-wal", "-shm"]) fs.rmSync(file + suffix, { force: true });
      fs.renameSync(file, file + ".damaged");
      fs.closeSync(fs.openSync(file, "a", 0o600));
      return (this.#sql = open(file));
    }
  }

  /** `store` runs once, unless it throws. */
  importOnce(kind: "cookies" | "localStorage", store: (items: any[]) => void) {
    const { sql } = this;
    const bit = kind === "cookies" ? 1 : 2;
    const done = sql.query("PRAGMA user_version").get().user_version;
    if (this.#directory === null || done & bit) return;
    try {
      sql.transaction(store)(require("internal/desktop/electron/profile_import")[kind](this.#directory));
    } catch (error: any) {
      if (error.code !== "ENOENT")
        return process.emitWarning(`Could not import ${kind}: ${error.message}`, "DesktopWarning");
    }
    sql.run(`PRAGMA user_version = ${done | bit}`);
  }

  #importLocalStorage() {
    this.importOnce("localStorage", items => {
      const insert = this.sql.query("INSERT OR IGNORE INTO local_storage VALUES (?, ?, ?)");
      for (const [origin, key, value] of items)
        insert.run(origin, Buffer.from(key, "utf16le"), Buffer.from(value, "utf16le"));
    });
  }

  localStorage(origin: string) {
    if (this.#local.$size === 0) this.#importLocalStorage();
    let storage = this.#local.$get(origin);
    if (!storage) this.#local.$set(origin, (storage = new LocalStorage(this.sql, origin)));
    return storage;
  }

  indexedDB(origin: string, name: string) {
    const key = `${origin}\n${name}`;
    let database = this.#databases.$get(key);
    if (!database) this.#databases.$set(key, (database = new IndexedDatabase(this.sql, origin, name)));
    return database;
  }

  indexedDatabases(origin: string) {
    return this.sql
      .query("SELECT name, meta ->> 'version' AS version FROM idb WHERE origin = ?")
      .all(origin)
      .map(it => ({ ...it, name: nameOf(it.name) }));
  }

  caches(origin: string) {
    return require("internal/desktop/web/origin_files").caches(this.sql, origin);
  }

  /** Of the origin private file system. */
  directoryOf(origin: string) {
    this.#files ??= this.#directory === null ? temporaryDirectory() : path.join(this.#directory, "File System");
    const directory = path.join(this.#files, Bun.CryptoHasher.hash("sha256", origin, "hex").slice(0, 32));
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    return directory;
  }

  async usageOf(origin: string) {
    const sum = (rows: string) => this.sql.query(`SELECT total(${rows} WHERE origin = ?`).values(origin)[0][0];
    return {
      indexedDB: sum("length(key) + length(value)) FROM idb_rows JOIN idb_tables ON id = tab"),
      caches: sum("length(about) + length(body)) FROM cache_entries JOIN caches ON id = cache"),
    };
  }

  clearLocalStorage(matches: (origin: string) => boolean) {
    this.#importLocalStorage();
    const stored = this.sql.query("SELECT DISTINCT origin FROM local_storage").values().flat();
    for (const origin of new Set<string>([...stored, ...this.#local.$keys()])) {
      if (matches(origin)) this.localStorage(origin).clear();
    }
    this.flush();
  }

  clearIndexedDB(matches: (origin: string) => boolean) {
    for (const [origin, name] of this.sql.query("SELECT origin, name FROM idb").values()) {
      if (matches(origin)) this.indexedDB(origin, nameOf(name)).erase();
    }
  }

  flush() {
    this.#local.$forEach(storage => storage.flush());
  }
}

export default { Storage, LocalStorage };
