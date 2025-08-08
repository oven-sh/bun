enum SSLMode {
  disable = 0,
  prefer = 1,
  require = 2,
  verify_ca = 3,
  verify_full = 4,
}

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
          const [sub_query, sub_values] = normalizeQuery(value[_strings], value[_values], binding_idx);
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

export default { SSLMode, normalizeSSLMode, normalizeQuery };
