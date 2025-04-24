import type * as BunTypes from "bun";

const enum QueryStatus {
  active = 1 << 1,
  cancelled = 1 << 2,
  error = 1 << 3,
  executed = 1 << 4,
  invalidHandle = 1 << 5,
}
const cmds = ["", "INSERT", "DELETE", "UPDATE", "MERGE", "SELECT", "MOVE", "FETCH", "COPY"];

const PublicArray = globalThis.Array;
const enum SSLMode {
  disable = 0,
  prefer = 1,
  require = 2,
  verify_ca = 3,
  verify_full = 4,
}

const { hideFromStack } = require("internal/shared");
const defineProperties = Object.defineProperties;

function connectionClosedError() {
  return $ERR_POSTGRES_CONNECTION_CLOSED("Connection closed");
}
function notTaggedCallError() {
  return $ERR_POSTGRES_NOT_TAGGED_CALL("Query not called as a tagged template literal");
}
hideFromStack(connectionClosedError);
hideFromStack(notTaggedCallError);

enum SQLQueryResultMode {
  objects = 0,
  values = 1,
  raw = 2,
}
const escapeIdentifier = function escape(str) {
  return '"' + str.replaceAll('"', '""').replaceAll(".", '"."') + '"';
};
class SQLResultArray extends PublicArray {
  static [Symbol.toStringTag] = "SQLResults";

  declare command: string | null;
  declare count: number | null;

  constructor() {
    super();
    // match postgres's result array, in this way for in will not list the properties and .map will not return undefined command and count
    Object.defineProperties(this, {
      command: { value: null, writable: true },
      count: { value: null, writable: true },
    });
  }
  static get [Symbol.species]() {
    return Array;
  }
}

const _resolve = Symbol("resolve");
const _reject = Symbol("reject");
const _handle = Symbol("handle");
const _run = Symbol("run");
const _queryStatus = Symbol("status");
const _handler = Symbol("handler");
const _strings = Symbol("strings");
const _values = Symbol("values");
const _poolSize = Symbol("poolSize");
const _flags = Symbol("flags");
const _results = Symbol("results");
const PublicPromise = Promise;
type TransactionCallback = (sql: (strings: string, ...values: any[]) => Query) => Promise<any>;

const { createConnection: _createConnection, createQuery: doCreateQuery, init } = $zig("postgres.zig", "createBinding");

function normalizeSSLMode(value: string): SSLMode {
  if (!value) {
    return SSLMode.disable;
  }

  value = (value + "").toLowerCase();
  switch (value) {
    case "disable":
      return SSLMode.disable;
    case "prefer":
      return SSLMode.prefer;
    case "require":
    case "required":
      return SSLMode.require;
    case "verify-ca":
    case "verify_ca":
      return SSLMode.verify_ca;
    case "verify-full":
    case "verify_full":
      return SSLMode.verify_full;
    default: {
      break;
    }
  }

  throw $ERR_INVALID_ARG_VALUE("sslmode", value);
}

enum SQLQueryFlags {
  none = 0,
  allowUnsafeTransaction = 1 << 0,
  unsafe = 1 << 1,
  bigint = 1 << 2,
  simple = 1 << 3,
  notTagged = 1 << 4,
}

function getQueryHandle(query) {
  let handle = query[_handle];
  if (!handle) {
    try {
      query[_handle] = handle = doCreateQuery(
        query[_strings],
        query[_values],
        query[_flags] & SQLQueryFlags.allowUnsafeTransaction,
        query[_poolSize],
        query[_flags] & SQLQueryFlags.bigint,
        query[_flags] & SQLQueryFlags.simple,
      );
    } catch (err) {
      query[_queryStatus] |= QueryStatus.error | QueryStatus.invalidHandle;
      query.reject(err);
    }
  }
  return handle;
}

enum SQLCommand {
  insert = 0,
  update = 1,
  updateSet = 2,
  where = 3,
  whereIn = 4,
  none = -1,
}

function commandToString(command: SQLCommand): string {
  switch (command) {
    case SQLCommand.insert:
      return "INSERT";
    case SQLCommand.updateSet:
    case SQLCommand.update:
      return "UPDATE";
    case SQLCommand.whereIn:
    case SQLCommand.where:
      return "WHERE";
    default:
      return "";
  }
}

function detectCommand(query: string): SQLCommand {
  const text = query.toLowerCase().trim();
  const text_len = text.length;

  let token = "";
  let command = SQLCommand.none;
  let quoted = false;
  for (let i = 0; i < text_len; i++) {
    const char = text[i];
    switch (char) {
      case " ": // Space
      case "\n": // Line feed
      case "\t": // Tab character
      case "\r": // Carriage return
      case "\f": // Form feed
      case "\v": {
        switch (token) {
          case "insert": {
            if (command === SQLCommand.none) {
              return SQLCommand.insert;
            }
            return command;
          }
          case "update": {
            if (command === SQLCommand.none) {
              command = SQLCommand.update;
              token = "";
              continue; // try to find SET
            }
            return command;
          }
          case "where": {
            command = SQLCommand.where;
            token = "";
            continue; // try to find IN
          }
          case "set": {
            if (command === SQLCommand.update) {
              command = SQLCommand.updateSet;
              token = "";
              continue; // try to find WHERE
            }
            return command;
          }
          case "in": {
            if (command === SQLCommand.where) {
              return SQLCommand.whereIn;
            }
            return command;
          }
          default: {
            token = "";
            continue;
          }
        }
      }
      default: {
        // skip quoted commands
        if (char === '"') {
          quoted = !quoted;
          continue;
        }
        if (!quoted) {
          token += char;
        }
      }
    }
  }
  if (token) {
    switch (command) {
      case SQLCommand.none: {
        switch (token) {
          case "insert":
            return SQLCommand.insert;
          case "update":
            return SQLCommand.update;
          case "where":
            return SQLCommand.where;
          default:
            return SQLCommand.none;
        }
      }
      case SQLCommand.update: {
        if (token === "set") {
          return SQLCommand.updateSet;
        }
        return SQLCommand.update;
      }
      case SQLCommand.where: {
        if (token === "in") {
          return SQLCommand.whereIn;
        }
        return SQLCommand.where;
      }
    }
  }

  return command;
}

// --- SQLArrayParameter definition ---
class SQLArrayParameter {
  columns: string[];
  value: any;
  constructor(columns: string[], value: any) {
    this.columns = columns;
    this.value = value;
  }
}
// ---

function normalizeQuery(strings, values, binding_idx = 1) {
  if (typeof strings === "string") {
    // identifier or unsafe query
    return [strings, values || []];
  }
  if (!$isArray(strings)) {
    // we should not hit this path
    throw new SyntaxError("Invalid query: SQL Fragment cannot be executed or was misused");
  }
  const str_len = strings.length;
  if (str_len === 0) {
    return ["", []];
  }
  let binding_values: any[] = [];
  let query = "";
  for (let i = 0; i < str_len; i++) {
    const string = strings[i];

    if (typeof string === "string") {
      query += string;
      if (values.length > i) {
        const value = values[i];
        if (value instanceof Query) {
          const [sub_query, sub_values] = normalizeQuery(value[_strings], value[_values], binding_idx);
          query += sub_query;
          for (let j = 0; j < sub_values.length; j++) {
            binding_values.push(sub_values[j]);
          }
          binding_idx += sub_values.length;
        } else if (value instanceof SQLArrayParameter) {
          const command = detectCommand(query);
          // only selectIn, insert, update, updateSet are allowed
          if (command === SQLCommand.none || command === SQLCommand.where) {
            throw new SyntaxError("Helper are only allowed for INSERT, UPDATE and WHERE IN commands");
          }
          const { columns, value: items } = value as SQLArrayParameter;
          const columnCount = columns.length;
          if (columnCount === 0 && command !== SQLCommand.whereIn) {
            throw new SyntaxError(`Cannot ${commandToString(command)} with no columns`);
          }
          const lastColumnIndex = columns.length - 1;

          if (command === SQLCommand.insert) {
            //
            // insert into users ${sql(users)} or insert into users ${sql(user)}
            //

            query += "(";
            for (let j = 0; j < columnCount; j++) {
              query += escapeIdentifier(columns[j]);
              if (j < lastColumnIndex) {
                query += ", ";
              }
            }
            query += ") VALUES";
            if ($isArray(items)) {
              const itemsCount = items.length;
              const lastItemIndex = itemsCount - 1;
              for (let j = 0; j < itemsCount; j++) {
                query += "(";
                const item = items[j];
                for (let k = 0; k < columnCount; k++) {
                  const column = columns[k];
                  const columnValue = item[column];
                  query += `$${binding_idx++}${k < lastColumnIndex ? ", " : ""}`;
                  if (typeof columnValue === "undefined") {
                    binding_values.push(null);
                  } else {
                    binding_values.push(columnValue);
                  }
                }
                if (j < lastItemIndex) {
                  query += "),";
                } else {
                  query += ") "; // the user can add RETURNING * or RETURNING id
                }
              }
            } else {
              query += "(";
              const item = items;
              for (let j = 0; j < columnCount; j++) {
                const column = columns[j];
                const columnValue = item[column];
                query += `$${binding_idx++}${j < lastColumnIndex ? ", " : ""}`;
                if (typeof columnValue === "undefined") {
                  binding_values.push(null);
                } else {
                  binding_values.push(columnValue);
                }
              }
              query += ") "; // the user can add RETURNING * or RETURNING id
            }
          } else if (command === SQLCommand.whereIn) {
            // SELECT * FROM users WHERE id IN (${sql([1, 2, 3])})
            if (!$isArray(items)) {
              throw new SyntaxError("An array of values is required for WHERE IN helper");
            }
            const itemsCount = items.length;
            const lastItemIndex = itemsCount - 1;
            query += "(";
            for (let j = 0; j < itemsCount; j++) {
              query += `$${binding_idx++}${j < lastItemIndex ? ", " : ""}`;
              if (columnCount > 0) {
                // we must use a key from a object
                if (columnCount > 1) {
                  // we should not pass multiple columns here
                  throw new SyntaxError("Cannot use WHERE IN helper with multiple columns");
                }
                // SELECT * FROM users WHERE id IN (${sql(users, "id")})
                const value = items[j];
                if (typeof value === "undefined") {
                  binding_values.push(null);
                } else {
                  const value_from_key = value[columns[0]];

                  if (typeof value_from_key === "undefined") {
                    binding_values.push(null);
                  } else {
                    binding_values.push(value_from_key);
                  }
                }
              } else {
                const value = items[j];
                if (typeof value === "undefined") {
                  binding_values.push(null);
                } else {
                  binding_values.push(value);
                }
              }
            }
            query += ") "; // more conditions can be added after this
          } else {
            // UPDATE users SET ${sql({ name: "John", age: 31 })} WHERE id = 1
            let item;
            if ($isArray(items)) {
              if (items.length > 1) {
                throw new SyntaxError("Cannot use array of objects for UPDATE");
              }
              item = items[0];
            } else {
              item = items;
            }
            // no need to include if is updateSet
            if (command === SQLCommand.update) {
              query += " SET ";
            }
            for (let i = 0; i < columnCount; i++) {
              const column = columns[i];
              const columnValue = item[column];
              query += `${escapeIdentifier(column)} = $${binding_idx++}${i < lastColumnIndex ? ", " : ""}`;
              if (typeof columnValue === "undefined") {
                binding_values.push(null);
              } else {
                binding_values.push(columnValue);
              }
            }
            query += " "; // the user can add where clause after this
          }
        } else {
          //TODO: handle sql.array parameters
          query += `$${binding_idx++} `;
          if (typeof value === "undefined") {
            binding_values.push(null);
          } else {
            binding_values.push(value);
          }
        }
      }
    } else {
      throw new SyntaxError("Invalid query: SQL Fragment cannot be executed or was misused");
    }
  }

  return [query, binding_values];
}

class Query extends PublicPromise {
  [_resolve];
  [_reject];
  [_handle];
  [_handler];
  [_queryStatus] = 0;
  [_strings];
  [_values];

  [Symbol.for("nodejs.util.inspect.custom")]() {
    const status = this[_queryStatus];
    const active = (status & QueryStatus.active) != 0;
    const cancelled = (status & QueryStatus.cancelled) != 0;
    const executed = (status & QueryStatus.executed) != 0;
    const error = (status & QueryStatus.error) != 0;
    return `PostgresQuery { ${active ? "active" : ""} ${cancelled ? "cancelled" : ""} ${executed ? "executed" : ""} ${error ? "error" : ""} }`;
  }

  constructor(strings, values, flags, poolSize, handler) {
    var resolve_, reject_;
    super((resolve, reject) => {
      resolve_ = resolve;
      reject_ = reject;
    });
    if (typeof strings === "string") {
      if (!(flags & SQLQueryFlags.unsafe)) {
        // identifier (cannot be executed in safe mode)
        flags |= SQLQueryFlags.notTagged;
        strings = escapeIdentifier(strings);
      }
    }
    this[_resolve] = resolve_;
    this[_reject] = reject_;
    this[_handle] = null;
    this[_handler] = handler;
    this[_queryStatus] = 0;
    this[_poolSize] = poolSize;
    this[_strings] = strings;
    this[_values] = values;
    this[_flags] = flags;

    this[_results] = null;
  }

  async [_run](async: boolean) {
    const { [_handler]: handler, [_queryStatus]: status } = this;

    if (status & (QueryStatus.executed | QueryStatus.error | QueryStatus.cancelled | QueryStatus.invalidHandle)) {
      return;
    }
    if (this[_flags] & SQLQueryFlags.notTagged) {
      this.reject(notTaggedCallError());
      return;
    }
    this[_queryStatus] |= QueryStatus.executed;

    const handle = getQueryHandle(this);
    if (!handle) return this;

    if (async) {
      // Ensure it's actually async
      // eslint-disable-next-line
      await 1;
    }

    try {
      return handler(this, handle);
    } catch (err) {
      this[_queryStatus] |= QueryStatus.error;
      this.reject(err);
    }
  }
  get active() {
    return (this[_queryStatus] & QueryStatus.active) != 0;
  }

  set active(value) {
    const status = this[_queryStatus];
    if (status & (QueryStatus.cancelled | QueryStatus.error)) {
      return;
    }

    if (value) {
      this[_queryStatus] |= QueryStatus.active;
    } else {
      this[_queryStatus] &= ~QueryStatus.active;
    }
  }

  get cancelled() {
    return (this[_queryStatus] & QueryStatus.cancelled) !== 0;
  }

  resolve(x) {
    this[_queryStatus] &= ~QueryStatus.active;
    const handle = getQueryHandle(this);
    if (!handle) return this;
    handle.done();
    return this[_resolve](x);
  }

  reject(x) {
    this[_queryStatus] &= ~QueryStatus.active;
    this[_queryStatus] |= QueryStatus.error;
    if (!(this[_queryStatus] & QueryStatus.invalidHandle)) {
      const handle = getQueryHandle(this);
      if (!handle) return this[_reject](x);
      handle.done();
    }

    return this[_reject](x);
  }

  cancel() {
    var status = this[_queryStatus];
    if (status & QueryStatus.cancelled) {
      return this;
    }
    this[_queryStatus] |= QueryStatus.cancelled;

    if (status & QueryStatus.executed) {
      const handle = getQueryHandle(this);
      handle.cancel();
    }

    return this;
  }

  execute() {
    this[_run](false);
    return this;
  }

  raw() {
    const handle = getQueryHandle(this);
    if (!handle) return this;
    handle.setMode(SQLQueryResultMode.raw);
    return this;
  }

  simple() {
    this[_flags] |= SQLQueryFlags.simple;
    return this;
  }

  values() {
    const handle = getQueryHandle(this);
    if (!handle) return this;
    handle.setMode(SQLQueryResultMode.values);
    return this;
  }

  then() {
    if (this[_flags] & SQLQueryFlags.notTagged) {
      throw notTaggedCallError();
    }
    this[_run](true);
    const result = super.$then.$apply(this, arguments);
    $markPromiseAsHandled(result);
    return result;
  }

  catch() {
    if (this[_flags] & SQLQueryFlags.notTagged) {
      throw notTaggedCallError();
    }
    this[_run](true);
    const result = super.catch.$apply(this, arguments);
    $markPromiseAsHandled(result);
    return result;
  }

  finally() {
    if (this[_flags] & SQLQueryFlags.notTagged) {
      throw notTaggedCallError();
    }
    this[_run](true);
    return super.finally.$apply(this, arguments);
  }
}
Object.defineProperty(Query, Symbol.species, { value: PublicPromise });
Object.defineProperty(Query, Symbol.toStringTag, { value: "Query" });
init(
  function onResolvePostgresQuery(query, result, commandTag, count, queries, is_last) {
    /// simple queries
    if (query[_flags] & SQLQueryFlags.simple) {
      // simple can have multiple results or a single result
      if (is_last) {
        if (queries) {
          const queriesIndex = queries.indexOf(query);
          if (queriesIndex !== -1) {
            queries.splice(queriesIndex, 1);
          }
        }
        try {
          query.resolve(query[_results]);
        } catch {}
        return;
      }
      $assert(result instanceof SQLResultArray, "Invalid result array");
      // prepare for next query
      query[_handle].setPendingValue(new SQLResultArray());

      if (typeof commandTag === "string") {
        if (commandTag.length > 0) {
          (result as any).command = commandTag;
        }
      } else {
        (result as any).command = cmds[commandTag];
      }

      (result as any).count = count || 0;
      const last_result = query[_results];

      if (!last_result) {
        query[_results] = result;
      } else {
        if (last_result instanceof SQLResultArray) {
          // multiple results
          query[_results] = [last_result, result];
        } else {
          // 3 or more results
          last_result.push(result);
        }
      }
      return;
    }
    /// prepared statements
    $assert(result instanceof SQLResultArray, "Invalid result array");
    if (typeof commandTag === "string") {
      if (commandTag.length > 0) {
        (result as any).command = commandTag;
      }
    } else {
      (result as any).command = cmds[commandTag];
    }

    (result as any).count = count || 0;
    if (queries) {
      const queriesIndex = queries.indexOf(query);
      if (queriesIndex !== -1) {
        queries.splice(queriesIndex, 1);
      }
    }
    try {
      query.resolve(result);
    } catch {}
  },
  function onRejectPostgresQuery(query, reject, queries) {
    if (queries) {
      const queriesIndex = queries.indexOf(query);
      if (queriesIndex !== -1) {
        queries.splice(queriesIndex, 1);
      }
    }

    try {
      query.reject(reject);
    } catch {}
  },
);

// --- defaultSQLObject and SQL definition ---
const defaultSQLObject = {
  array: function (value: any, ...columns: string[]): SQLArrayParameter {
    if (
      columns.length === 0 &&
      $isArray(value) &&
      value.length > 0 &&
      typeof value[0] === "object" &&
      value[0] !== null
    ) {
      columns = Object.keys(value[0]);
    }
    return new SQLArrayParameter(columns, value);
  },
};

const SQL = defaultSQLObject;
// ---

var exportsObject = {
  sql: defaultSQLObject,
  default: defaultSQLObject,
  SQL: SQL,
  Query,
  postgres: SQL,
};

export default exportsObject;
