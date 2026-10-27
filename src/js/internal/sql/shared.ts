import type { QueryStrings, Query as QueryType } from "./query";

const PublicArray = Array;
const {
  Query,
  SQLQueryFlags,
  symbols: { _strings, _values, _flags },
} = require("internal/sql/query");

type ArrayType =
  | "BOOLEAN"
  | "BYTEA"
  | "CHAR"
  | "NAME"
  | "TEXT"
  | "CHAR"
  | "VARCHAR"
  | "SMALLINT"
  | "INT2VECTOR"
  | "INTEGER"
  | "INT"
  | "BIGINT"
  | "REAL"
  | "DOUBLE PRECISION"
  | "NUMERIC"
  | "MONEY"
  | "OID"
  | "TID"
  | "XID"
  | "CID"
  | "JSON"
  | "JSONB"
  | "JSONPATH"
  | "XML"
  | "UUID"
  | "POINT"
  | "LSEG"
  | "PATH"
  | "BOX"
  | "POLYGON"
  | "LINE"
  | "CIRCLE"
  | "CIDR"
  | "MACADDR"
  | "INET"
  | "MACADDR8"
  | "DATE"
  | "TIME"
  | "TIMESTAMP"
  | "TIMESTAMPTZ"
  | "INTERVAL"
  | "TIMETZ"
  | "BIT"
  | "VARBIT"
  | "ACLITEM"
  | "PG_DATABASE"
  | (string & {});
export type { ArrayType, SQLArrayParameter, SQLResultArray };
class SQLArrayParameter {
  serializedValues: string;
  /** `undefined`: no cast, the server infers the type. */
  arrayType: ArrayType | undefined;
  constructor(serializedValues: string, arrayType: ArrayType | undefined) {
    this.serializedValues = serializedValues;
    this.arrayType = arrayType;
  }
  toString() {
    return this.serializedValues;
  }
  toJSON() {
    return this.serializedValues;
  }
}

export interface SQLStatementDescription {
  string: string;
  types: number[];
  columns: object[];
}
/** The native query. */
interface ResultDescriber {
  describeResult(number: number): SQLStatementDescription | null;
}

class SQLResultArray<T> extends PublicArray<T> {
  count: number | null = null;
  command: string | null = null;
  lastInsertRowid: number | bigint | string | null = null;
  affectedRows: number | bigint | null = null;
  /** The native query while `#undescribed` is a number that it makes the description for. */
  #statement: SQLStatementDescription | ResultDescriber | null = null;
  #undescribed = -1;

  static [Symbol.toStringTag] = "SQLResults";

  constructor(values?: T[]) {
    super();
    if (values !== undefined) {
      for (let i = 0, length = values.length; i < length; i++) $putByValDirect(this, i, values[i]);
    }
  }

  get statement() {
    const number = this.#undescribed;
    if (number !== -1) {
      this.#statement = (this.#statement as ResultDescriber).describeResult(number);
      this.#undescribed = -1;
    }
    return this.#statement as SQLStatementDescription | null;
  }
  set statement(value) {
    this.#statement = value;
    this.#undescribed = -1;
  }
  get columns() {
    return this.statement?.columns ?? null;
  }
  /** `statement`: the description, or the number that `handle` makes it for once somebody reads it. */
  static describe(
    result: SQLResultArray<unknown>,
    handle: ResultDescriber,
    statement: SQLStatementDescription | number | null,
  ) {
    if (typeof statement === "number") {
      result.#statement = handle;
      result.#undescribed = statement;
    } else {
      result.#statement = statement;
    }
  }

  /** `instanceof` asks `Array[Symbol.hasInstance]`, which a program can define. */
  static isResult(array: unknown[]): boolean {
    return #undescribed in array;
  }

  static get [Symbol.species]() {
    return Array;
  }
}
export type { SQLHelper };
class SQLHelper<T> {
  public readonly value: T[];
  public readonly columns: (keyof T)[];

  constructor(value: T[], keys: (keyof T)[]) {
    if (keys.length === 0 && $isObject(value[0])) {
      keys = Object.keys(value[0]) as (keyof T)[];
    } else {
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (typeof key !== "string" && typeof key !== "number") {
          throw new Error(`Keys must be strings or numbers: ${String(key)}`);
        }
      }
    }

    this.value = value;
    this.columns = keys;
  }
}

const enum SQLCommand {
  insert = 0,
  update = 1,
  updateSet = 2,
  where = 3,
  in = 4,
  none = -1,
}

// Both are anchored and skip leading comments. Every character has one way to match, so a miss costs one pass.
const transactionStart = /^\s*(?:(?:--[^\n]*\n|\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\/)\s*)*(?:begin|start\s+transaction)\b/i;
function isUnsafeTransactionStart(sql: string): boolean {
  return transactionStart.test(sql);
}

// A ";" is an empty statement. SQLite steps over it when it compiles the first one.
const leadingKeyword = /^[\s(;]*(?:(?:--[^\n]*\n|\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\/)[\s(;]*)*([a-z]+)/i;
function firstKeyword(sql: string): string {
  const match = leadingKeyword.exec(sql);
  return match === null ? "" : match[1].toUpperCase();
}

function isWordChar(c: number) {
  return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95 || c === 36 || c >= 128;
}

/** Where the `--` comment of the line from `start` to `end` begins, or `end`. Dashes in quotes begin none. */
function lineCommentStart(text: string, start: number, end: number): number {
  for (let i = start; i < end; i++) {
    const c = text.charCodeAt(i);
    if (c === 39 || c === 34 || c === 96) {
      i = text.indexOf(text[i], i + 1);
      if (i === -1 || i >= end) break;
    } else if (c === 45 && text.charCodeAt(i + 1) === 45) {
      return i;
    }
  }
  return end;
}

/** Start of the last word that ends at or before `end`, or -1. Steps over quoted text and comments. */
function lastWordStart(text: string, end: number): number {
  let i = end - 1;
  for (; i >= 0; i--) {
    const c = text.charCodeAt(i);
    if (c === 39 || c === 34 || c === 96) {
      i = text.lastIndexOf(text[i], i - 1);
    } else if (c === 47 && text.charCodeAt(i - 1) === 42) {
      i = text.lastIndexOf("/*", i - 2);
    } else if (c === 10) {
      const lineStart = text.lastIndexOf("\n", i - 1) + 1;
      const dashes = text.indexOf("--", lineStart);
      if (dashes !== -1 && dashes < i) i = lineCommentStart(text, lineStart, i);
    } else if (isWordChar(c)) {
      break;
    }
  }
  if (i < 0) return -1;
  while (i > 0 && isWordChar(text.charCodeAt(i - 1))) i--;
  return i;
}

const longestKeyword = "duplicate".length;
function wordAt(text: string, start: number): string {
  let end = start + 1;
  while (end - start <= longestKeyword && isWordChar(text.charCodeAt(end))) end++;
  return end - start > longestKeyword ? "" : text.slice(start, end).toLowerCase();
}

/** The keyword nearest to the end of `text` that says what a helper placed there expands to. */
function helperCommand(text: string): SQLCommand {
  for (let at = lastWordStart(text, text.length); at !== -1; at = lastWordStart(text, at)) {
    switch (wordAt(text, at)) {
      case "insert":
        return SQLCommand.insert;
      case "set":
        return SQLCommand.updateSet;
      case "where":
        return SQLCommand.where;
      case "in":
        return SQLCommand.in;
      case "update": {
        // ON DUPLICATE KEY UPDATE takes assignments without SET
        let word = lastWordStart(text, at);
        if (word === -1 || wordAt(text, word) !== "key") return SQLCommand.update;
        word = lastWordStart(text, word);
        return word !== -1 && wordAt(text, word) === "duplicate" ? SQLCommand.updateSet : SQLCommand.update;
      }
    }
  }
  return SQLCommand.none;
}

type RenameColumn = (name: string) => string;

/** `options.transform` as `parseOptions` stores it. */
export interface Transform {
  /** What `undefined` stands for. Not given: NULL, and a helper leaves out a column that is nothing else. */
  undefined: unknown;
  column: {
    /** From the database: the names of the result columns. */
    from: RenameColumn | undefined;
    /** To the database: the keys of `sql({...})`, the columns of `sql(rows, "a")`, `sql("name")`. */
    to: RenameColumn | undefined;
  };
}

function upperCaseAfterUnderscores(name: string, first: string): string {
  for (let i = 1; i < name.length; i++) {
    const char = name[i];
    first += char === "_" && i + 1 < name.length ? name[++i].toUpperCase() : char;
  }
  return first;
}
function toCamel(name: string): string {
  return upperCaseAfterUnderscores(name, name.slice(0, 1));
}
function toPascal(name: string): string {
  return upperCaseAfterUnderscores(name, name.slice(0, 1).toUpperCase());
}
function toKebab(name: string): string {
  return name.replaceAll("_", "-");
}
function fromCamel(name: string): string {
  return name.replace(/[A-Z]/g, "_$&").toLowerCase();
}
function fromPascal(name: string): string {
  return (name.slice(0, 1) + name.slice(1).replace(/[A-Z]/g, "_$&")).toLowerCase();
}
function fromKebab(name: string): string {
  return name.replaceAll("-", "_");
}
// `transform: SQL.toCamel` renames in one direction only.
toCamel.column = { from: toCamel };
toPascal.column = { from: toPascal };
toKebab.column = { from: toKebab };
fromCamel.column = { to: fromCamel };
fromPascal.column = { to: fromPascal };
fromKebab.column = { to: fromKebab };

/// What the three adapters say in the same words.
abstract class SQLDialect {
  abstract readonly connectionInfo: { transform?: Transform };
  /// around an identifier
  readonly quote: string = '"';
  readonly begin: string = "BEGIN";
  /// `in ()` is a syntax error on the servers
  readonly emptyList: string = "(NULL)";
  /// the values of sql.unsafe() may be an object
  readonly namedParameters: boolean = false;

  /// `code`: what follows ERR_POSTGRES_, ERR_MYSQL_ or ERR_SQLITE_
  abstract error(code: string, message: string): Error;

  connectionClosedError() {
    return this.error("CONNECTION_CLOSED", "Connection closed");
  }
  notTaggedCallError() {
    return this.error("NOT_TAGGED_CALL", "Query not called as a tagged template literal");
  }
  queryCancelledError() {
    return this.error("QUERY_CANCELLED", "Query cancelled");
  }
  invalidTransactionStateError(message: string) {
    return this.error("INVALID_TRANSACTION_STATE", message);
  }

  /** For the 1-based `index`. */
  placeholder(_index: number): string {
    return "?";
  }

  normalizeQuery(strings: QueryStrings, values: unknown[]): [string, unknown[]] {
    return normalizeQuery(this, strings, values);
  }

  getTransactionCommands(options?: string): TransactionCommands {
    // They become a part of the statement, so nothing that could end it or start another.
    if (options && !/^[A-Za-z ,]*$/.test(options)) {
      throw new Error("Transaction options can only contain letters, spaces, and commas.");
    }
    return { BEGIN: options ? `${this.begin} ${options}` : this.begin, COMMIT: "COMMIT", ROLLBACK: "ROLLBACK" };
  }
}

class QueryBuilder {
  text = "";
  values: unknown[] = [];
  readonly adapter: SQLDialect;

  constructor(adapter: SQLDialect) {
    this.adapter = adapter;
  }

  template(strings: readonly string[], values: unknown[]) {
    for (let i = 0; i < strings.length; i++) {
      const string = strings[i];
      if (typeof string !== "string") {
        throw new SyntaxError("Invalid query: SQL Fragment cannot be executed or was misused");
      }
      this.text += string;
      // the space: `${id}and` and `${sql(row)}returning *` keep working
      if (i < values.length) this.value(values[i], " ");
    }
  }

  /** `after` follows a parameter or a helper; a fragment is only its own text. */
  value(value: unknown, after: string) {
    if (value === undefined) value = this.undefinedValue() ?? null;
    if ($isObject(value)) {
      if (value instanceof Query) return this.fragment(value);
      if (value instanceof SQLHelper) {
        this.helper(value);
        this.text += after;
        return;
      }
      if (value instanceof SQLArrayParameter) {
        const { arrayType } = value;
        if (arrayType !== undefined) after = "::" + arrayType + "[]" + after;
        value = value.serializedValues;
      } else if ($isArray(value) && value[0] instanceof Query) {
        for (let i = 0; i < value.length; i++) {
          this.text += " ";
          this.value(value[i], "");
        }
        this.text += after;
        return;
      }
    }
    this.text += this.adapter.placeholder(this.values.push(value)) + after;
  }

  undefinedValue(): unknown {
    return $getByIdDirect(this.adapter.connectionInfo, "transform")?.undefined;
  }

  identifier(name: string | number): string {
    const { quote, connectionInfo } = this.adapter;
    const to = $getByIdDirect(connectionInfo, "transform")?.column.to;
    name = String(to === undefined ? name : to(String(name)));
    if (name.includes("\0")) {
      throw $ERR_INVALID_ARG_VALUE("name", name, "must not contain null bytes");
    }
    return quote + name.replaceAll(quote, quote + quote).replaceAll(".", quote + "." + quote) + quote;
  }

  fragment(query: QueryType<any, any>) {
    const strings = query[_strings];
    const values = query[_values];
    if (typeof strings !== "string") {
      if (!$isArray(strings)) {
        throw new SyntaxError("Invalid query: SQL Fragment cannot be executed or was misused");
      }
      return this.template(strings, values);
    }
    const flags = query[_flags];
    if (flags & SQLQueryFlags.notTagged) {
      this.text += this.identifier(strings);
      return;
    }
    if (flags & SQLQueryFlags.deferredText) {
      // `strings` is still the path
      throw new SyntaxError("sql.file() cannot be used as a fragment of another query");
    }
    this.text += strings;
    if (values == null) return;
    const count = values.length;
    if (count === undefined && this.adapter.namedParameters && Object.keys(values).length > 0) {
      throw new SyntaxError("Nested sql.unsafe() cannot have named parameters: the query around it binds by position");
    }
    // parts.map(sql.unsafe) passes the index
    if (!(count > 0)) return;
    if (this.values.length > 0 && this.adapter.placeholder(1) !== "?") {
      throw new SyntaxError(
        "Nested sql.unsafe() cannot have values when it follows other parameters: its $1 is the first parameter of the whole query. Use a sql`` fragment for the values",
      );
    }
    for (let i = 0; i < count; i++) this.values.push(values[i]);
  }

  helper(helper: SQLHelper<any>) {
    const command = helperCommand(this.text);
    switch (command) {
      case SQLCommand.insert:
        return this.insert(helper.value, helper.columns);
      case SQLCommand.in:
        return this.list(helper.value, helper.columns);
      case SQLCommand.update:
      case SQLCommand.updateSet:
        if (command === SQLCommand.update) this.text += " SET ";
        return this.assignments(helper.value, helper.columns);
      default:
        throw new SyntaxError("Helpers are only allowed for INSERT, UPDATE and IN commands");
    }
  }

  insert(rows: any[], columns: PropertyKey[]) {
    const rowCount = rows.length;
    const columnCount = columns.length;
    if (columnCount === 0) {
      throw new SyntaxError("Cannot INSERT with no columns");
    }
    const cells = $newArrayWithSize<unknown>(rowCount * columnCount);
    const defined = $newArrayWithSize<boolean>(columnCount);
    // `cells` is the list of the query's parameters as it is
    let plain = this.values.length === 0;
    for (let r = 0, at = 0; r < rowCount; r++) {
      const row = rows[r];
      if (row == null) {
        throw new SyntaxError("Cannot use null or undefined as an item in INSERT helper");
      }
      for (let c = 0; c < columnCount; c++, at++) {
        let cell = row[columns[c]];
        if (cell === undefined) cell = this.undefinedValue();
        $putByValDirect(cells, at, cell);
        if (cell === undefined) {
          plain = false;
          continue;
        }
        $putByValDirect(defined, c, true);
        if (
          $isObject(cell) &&
          (cell instanceof Query || cell instanceof SQLHelper || cell instanceof SQLArrayParameter || $isArray(cell))
        ) {
          plain = false;
        }
      }
    }

    let separator = "(";
    for (let c = 0; c < columnCount; c++) {
      if (!defined[c]) continue;
      this.text += separator + this.identifier(columns[c] as string);
      separator = ", ";
    }
    if (separator === "(") {
      throw new SyntaxError("Insert needs to have at least one column with a defined value");
    }
    this.text += ") VALUES";

    if (plain) {
      this.values = cells;
      if (this.adapter.placeholder(1) === "?") {
        const row = "(?" + ", ?".repeat(columnCount - 1) + ")";
        this.text += row + ("," + row).repeat(rowCount - 1);
        return;
      }
      const numbers = $newArrayWithSize<number>(columnCount);
      let text = this.text;
      for (let r = 0, number = 0; r < rowCount; r++) {
        for (let c = 0; c < columnCount; c++) $putByValDirect(numbers, c, ++number);
        text = `${text}${r === 0 ? "($" : ",($"}${numbers.join(", $")})`;
      }
      this.text = text;
      return;
    }

    for (let r = 0, at = 0; r < rowCount; r++) {
      separator = r === 0 ? "(" : ",(";
      for (let c = 0; c < columnCount; c++, at++) {
        if (!defined[c]) continue;
        this.text += separator;
        this.value(cells[at], "");
        separator = ", ";
      }
      this.text += ")";
    }
  }

  list(items: any[], columns: PropertyKey[]) {
    if (columns.length > 1) {
      throw new SyntaxError("Cannot use WHERE IN helper with multiple columns");
    }
    if (items.length === 0) {
      this.text += this.adapter.emptyList;
      return;
    }
    for (let i = 0; i < items.length; i++) {
      this.text += i === 0 ? "(" : ", ";
      let item = items[i];
      if (columns.length === 1 && item !== undefined) {
        if (item === null) {
          throw new SyntaxError("Cannot use null as an item in WHERE IN helper with a column");
        }
        item = item[columns[0]];
      }
      this.value(item, "");
    }
    this.text += ")";
  }

  assignments(rows: any[], columns: PropertyKey[]) {
    if (rows.length > 1) {
      throw new SyntaxError("Cannot use array of objects for UPDATE");
    }
    const row = rows[0];
    if (row == null) {
      throw new SyntaxError("Cannot use null or undefined as an item in UPDATE helper");
    }
    let separator = "";
    for (let c = 0; c < columns.length; c++) {
      let cell = row[columns[c]];
      if (cell === undefined) cell = this.undefinedValue();
      if (cell === undefined) continue;
      this.text += separator + this.identifier(columns[c] as string) + " = ";
      this.value(cell, "");
      separator = ", ";
    }
    if (separator === "") {
      throw new SyntaxError("Update needs to have at least one column");
    }
  }
}

function normalizeQuery(adapter: SQLDialect, strings: QueryStrings, values: unknown[]): [string, unknown[]] {
  if (typeof strings === "string") {
    return [strings, values ?? []];
  }
  if (!$isArray(strings)) {
    throw new SyntaxError("Invalid query: SQL Fragment cannot be executed or was misused");
  }
  const builder = new QueryBuilder(adapter);
  builder.template(strings, values);
  return [builder.text, builder.values];
}

export type OnConnected<Connection> = (
  ...args: [error: null, connection: Connection] | [error: Error, connection: null]
) => void;

export interface TransactionCommands {
  BEGIN: string;
  /// XA END
  BEFORE_COMMIT_OR_ROLLBACK?: string;
  COMMIT: string;
  ROLLBACK: string;
}

export interface DatabaseAdapter<Connection, ConnectionHandle, QueryHandle> extends SQLDialect {
  createQueryHandle(sql: string, values: unknown[], flags: number): QueryHandle;
  connect(onConnected: OnConnected<Connection>, reserved?: boolean): void;
  release(connection: Connection, prepared?: boolean): void;
  close(options?: { timeout?: number }): Promise<void>;
  flush(): void;

  isConnected(): boolean;
  get closed(): boolean;
  /** close({ timeout: 0 }) was called: the caller gave up on what is queued. */
  readonly closedAtOnce?: boolean;

  readonly supportsReservedConnections: boolean;
  /** `true`: `onConnected` was still queued and will never run. */
  cancelConnect(onConnected: OnConnected<Connection>): boolean;
  /** Throws `connectionClosedError()` unless the connection is open. */
  getConnectionForQuery(pooledConnection: Connection): ConnectionHandle;
  /** `handler(err)` runs once, after the connection is closed and before the user's `onclose`. */
  attachConnectionCloseHandler(connection: Connection, handler: (err: Error) => void): void;
  detachConnectionCloseHandler(connection: Connection, handler: (err: Error) => void): void;
  isInTransaction?(connection: Connection): boolean;
  copyStream?(query: QueryType<any, any>, writable: boolean): ReadableStream<Uint8Array> | WritableStream<unknown>;

  array(values: any[], typeNameOrID?: number | string): SQLArrayParameter;
  /** The parameter that stores `value` as JSON, where that is not its JSON text. */
  json?(value: unknown): object;
  getDistributedTransactionCommands(name: string): TransactionCommands | null;
  /** COMMIT PREPARED or ROLLBACK PREPARED */
  getFinishDistributedSQL(commit: boolean, name: string): string;
}
export default {
  SQLHelper,
  SQLResultArray,
  SQLArrayParameter,
  SQLDialect,
  isUnsafeTransactionStart,
  firstKeyword,
  transforms: {
    camel: { column: { from: toCamel, to: fromCamel } },
    pascal: { column: { from: toPascal, to: fromPascal } },
    kebab: { column: { from: toKebab, to: fromKebab } },
    toCamel,
    toPascal,
    toKebab,
    fromCamel,
    fromPascal,
    fromKebab,
  },
};
