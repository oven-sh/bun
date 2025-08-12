import type { Query } from "./query";
import type { SQLHelper } from "./shared";

const { SQLHelper } = require("internal/sql/shared");
const {
  Query,
  symbols: { _strings, _values },
} = require("internal/sql/query");
const { escapeIdentifier } = require("internal/sql/utils");

enum SQLCommand {
  insert = 0,
  update = 1,
  updateSet = 2,
  where = 3,
  whereIn = 4,
  none = -1,
}
export type { SQLCommand };

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

function normalizeQuery(
  strings: string | TemplateStringsArray,
  values: unknown[],
  binding_idx = 1,
): [string, unknown[]] {
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
          const q = value as Query<any, any>;
          const [sub_query, sub_values] = normalizeQuery(q[_strings], q[_values], binding_idx);
          query += sub_query;
          for (let j = 0; j < sub_values.length; j++) {
            binding_values.push(sub_values[j]);
          }
          binding_idx += sub_values.length;
        } else if (value instanceof SQLHelper) {
          const command = detectCommand(query);
          // only selectIn, insert, update, updateSet are allowed
          if (command === SQLCommand.none || command === SQLCommand.where) {
            throw new SyntaxError("Helpers are only allowed for INSERT, UPDATE and WHERE IN commands");
          }
          const { columns, value: items } = value as SQLHelper;
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

export default {
  normalizeQuery,
  SQLCommand,
  commandToString,
  detectCommand,
};
