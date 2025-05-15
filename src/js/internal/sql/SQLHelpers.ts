import { SQLCommand } from "./SQLTypes";

export const escapeIdentifier = function escape(str: string): string {
  return '"' + str.replace(/"/g, '""').replace(/\./g, '"."') + '"';
};

export class SQLArrayParameter {
  columns: string[];
  value: any;

  constructor(value: any, columns: string[] = []) {
    this.value = value;
    this.columns = columns;
  }
}

export function commandToString(command: SQLCommand): string {
  switch (command) {
    case SQLCommand.insert:
      return "INSERT";
    case SQLCommand.update:
    case SQLCommand.updateSet:
      return "UPDATE";
    case SQLCommand.where:
    case SQLCommand.whereIn:
      return "WHERE";
    default:
      return "";
  }
}

export function detectCommand(query: string): SQLCommand {
  let command = SQLCommand.none;
  const length = query.length;
  let quoted = false;
  let token = "";

  for (let i = 0; i < length; i++) {
    const char = query[i];
    switch (char) {
      case " ":
      case "\n":
      case "\t": {
        if (token.length === 0 || quoted) {
          continue;
        }
        switch (command) {
          case SQLCommand.none: {
            switch (token.toLowerCase()) {
              case "insert":
                command = SQLCommand.insert;
                break;
              case "update":
                command = SQLCommand.update;
                break;
              case "where":
                command = SQLCommand.where;
                break;
              default:
                break;
            }
            token = "";
            continue;
          }
          case SQLCommand.update: {
            if (token.toLowerCase() === "set") {
              command = SQLCommand.updateSet;
            }
            token = "";
            continue;
          }
          case SQLCommand.where: {
            if (token.toLowerCase() === "in") {
              command = SQLCommand.whereIn;
            }
            token = "";
            continue;
          }
          default: {
            token = "";
            continue;
          }
        }
      }
      default: {
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
        switch (token.toLowerCase()) {
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
        if (token.toLowerCase() === "set") {
          return SQLCommand.updateSet;
        }
        return SQLCommand.update;
      }
      case SQLCommand.where: {
        if (token.toLowerCase() === "in") {
          return SQLCommand.whereIn;
        }
        return SQLCommand.where;
      }
    }
  }

  return command;
}

export function normalizeQuery(
  strings: string | TemplateStringsArray,
  values: any[],
  adapter: any,
  binding_idx = 1,
): [string, any[]] {
  if (typeof strings === "string") {
    return [strings, values || []];
  }

  const params: any[] = [];
  let sql = "";
  const length = strings.length;

  for (let i = 0; i < length - 1; i++) {
    sql += strings[i];

    const value = values[i];

    if (value === null || value === undefined) {
      sql += "NULL";
    } else if (Array.isArray(value)) {
      const placeholders = value.map(() => `$${binding_idx++}`).join(", ");
      sql += `(${placeholders})`;
      value.forEach(v => params.push(v));
    } else if (value instanceof SQLArrayParameter) {
      const placeholders = value.value.map(() => `$${binding_idx++}`).join(", ");
      sql += `(${placeholders})`;
      value.value.forEach(v => params.push(v));
    } else {
      sql += `$${binding_idx++}`;
      params.push(value);
    }
  }

  sql += strings[length - 1];

  return [sql, params];
}
