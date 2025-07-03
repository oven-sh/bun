Bun provides native bindings for working with PostgreSQL databases with a modern, Promise-based API. The interface is designed to be simple and performant, using tagged template literals for queries and offering features like connection pooling, transactions, and prepared statements.

```ts
import { sql } from "bun";

const users = await sql`
  SELECT * FROM users
  WHERE active = ${true}
  LIMIT ${10}
`;

// Select with multiple conditions
const activeUsers = await sql`
  SELECT * 
  FROM users 
  WHERE active = ${true} 
  AND age >= ${18}
`;
```

{% features title="Features" %}

{% icon size=20 name="Shield" /%} Tagged template literals to protect against SQL injection

{% icon size=20 name="GitMerge" /%} Transactions

{% icon size=20 name="Variable" /%} Named & positional parameters

{% icon size=20 name="Network" /%} Connection pooling

{% icon size=20 name="Binary" /%} `BigInt` support

{% icon size=20 name="Key" /%} SASL Auth support (SCRAM-SHA-256), MD5, and Clear Text

{% icon size=20 name="Timer" /%} Connection timeouts

{% icon size=20 name="Database" /%} Returning rows as data objects, arrays of arrays, or `Buffer`

{% icon size=20 name="Code" /%} Binary protocol support makes it faster

{% icon size=20 name="Lock" /%} TLS support (and auth mode)

{% icon size=20 name="Settings" /%} Automatic configuration with environment variable

{% /features %}

### Inserting data

You can pass JavaScript values directly to the SQL template literal and escaping will be handled for you.

```ts
import { sql } from "bun";

// Basic insert with direct values
const [user] = await sql`
  INSERT INTO users (name, email) 
  VALUES (${name}, ${email})
  RETURNING *
`;

// Using object helper for cleaner syntax
const userData = {
  name: "Alice",
  email: "alice@example.com",
};

const [newUser] = await sql`
  INSERT INTO users ${sql(userData)}
  RETURNING *
`;
// Expands to: INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com')
```

### Bulk Insert

You can also pass arrays of objects to the SQL template literal and it will be expanded to a `INSERT INTO ... VALUES ...` statement.

```ts
const users = [
  { name: "Alice", email: "alice@example.com" },
  { name: "Bob", email: "bob@example.com" },
  { name: "Charlie", email: "charlie@example.com" },
];

await sql`INSERT INTO users ${sql(users)}`;
```

### Picking columns to insert

You can use `sql(object, ...string)` to pick which columns to insert. Each of the columns must be defined on the object.

```ts
const user = {
  name: "Alice",
  email: "alice@example.com",
  age: 25,
};

await sql`INSERT INTO users ${sql(user, "name", "email")}`;
// Only inserts name and email columns, ignoring other fields
```

## Query Results

By default, Bun's SQL client returns query results as arrays of objects, where each object represents a row with column names as keys. However, there are cases where you might want the data in a different format. The client provides two additional methods for this purpose.

### `sql``.values()` format

The `sql``.values()` method returns rows as arrays of values rather than objects. Each row becomes an array where the values are in the same order as the columns in your query.

```ts
const rows = await sql`SELECT * FROM users`.values();
console.log(rows);
```

This returns something like:

```ts
[
  ["Alice", "alice@example.com"],
  ["Bob", "bob@example.com"],
];
```

`sql``.values()` is especially useful if duplicate column names are returned in the query results. When using objects (the default), the last column name is used as the key in the object, which means duplicate column names overwrite each other &mdash; but when using `sql``.values()`, each column is present in the array so you can access the values of duplicate columns by index.

### `sql``.raw()` format

The `.raw()` method returns rows as arrays of `Buffer` objects. This can be useful for working with binary data or for performance reasons.

```ts
const rows = await sql`SELECT * FROM users`.raw();
console.log(rows); // [[Buffer, Buffer], [Buffer, Buffer], [Buffer, Buffer]]
```

## SQL Fragments

A common need in database applications is the ability to construct queries dynamically based on runtime conditions. Bun provides safe ways to do this without risking SQL injection.

### Dynamic Table Names

When you need to reference tables or schemas dynamically, use the `sql()` helper to ensure proper escaping:

```ts
// Safely reference tables dynamically
await sql`SELECT * FROM ${sql("users")}`;

// With schema qualification
await sql`SELECT * FROM ${sql("public.users")}`;
```

### Conditional Queries

You can use the `sql()` helper to build queries with conditional clauses. This allows you to create flexible queries that adapt to your application's needs:

```ts
// Optional WHERE clauses
const filterAge = true;
const minAge = 21;
const ageFilter = sql`AND age > ${minAge}`;
await sql`
  SELECT * FROM users
  WHERE active = ${true}
  ${filterAge ? ageFilter : sql``}
`;
```

### Dynamic columns in updates

You can use `sql(object, ...string)` to pick which columns to update. Each of the columns must be defined on the object. If the columns are not informed all keys will be used to update the row.

```ts
await sql`UPDATE users SET ${sql(user, "name", "email")} WHERE id = ${user.id}`;
// uses all keys from the object to update the row
await sql`UPDATE users SET ${sql(user)} WHERE id = ${user.id}`;
```

### Dynamic values and `where in`

Value lists can also be created dynamically, making where in queries simple too. Optionally you can pass a array of objects and inform what key to use to create the list.

```ts
await sql`SELECT * FROM users WHERE id IN ${sql([1, 2, 3])}`;

const users = [
  { id: 1, name: "Alice" },
  { id: 2, name: "Bob" },
  { id: 3, name: "Charlie" },
];
await sql`SELECT * FROM users WHERE id IN ${sql(users, "id")}`;
```

## `sql``.simple()`

The PostgreSQL wire protocol supports two types of queries: "simple" and "extended". Simple queries can contain multiple statements but don't support parameters, while extended queries (the default) support parameters but only allow one statement.

To run multiple statements in a single query, use `sql``.simple()`:

```ts
// Multiple statements in one query
await sql`
  SELECT 1;
  SELECT 2;
`.simple();
```

Simple queries are often useful for database migrations and setup scripts.

Note that simple queries cannot use parameters (`${value}`). If you need parameters, you must split your query into separate statements.

### Queries in files

You can use the `sql.file` method to read a query from a file and execute it, if the file includes $1, $2, etc you can pass parameters to the query. If no parameters are used it can execute multiple commands per file.

```ts
const result = await sql.file("query.sql", [1, 2, 3]);
```

### Unsafe Queries

You can use the `sql.unsafe` function to execute raw SQL strings. Use this with caution, as it will not escape user input. Executing more than one command per query is allowed if no parameters are used.

```ts
// Multiple commands without parameters
const result = await sql.unsafe(`
  SELECT ${userColumns} FROM users;
  SELECT ${accountColumns} FROM accounts;
`);

// Using parameters (only one command is allowed)
const result = await sql.unsafe(
  "SELECT " + dangerous + " FROM users WHERE id = $1",
  [id],
);
```

#### What is SQL Injection?

{% image href="https://xkcd.com/327/" src="https://imgs.xkcd.com/comics/exploits_of_a_mom.png" /%}

### Execute and Cancelling Queries

Bun's SQL is lazy, which means it will only start executing when awaited or executed with `.execute()`.
You can cancel a query that is currently executing by calling the `cancel()` method on the query object.

```ts
const query = await sql`SELECT * FROM users`.execute();
setTimeout(() => query.cancel(), 100);
await query;
```

## Database Environment Variables

`sql` connection parameters can be configured using environment variables. The client checks these variables in a specific order of precedence.

The following environment variables can be used to define the connection URL:

| Environment Variable        | Description                                |
| --------------------------- | ------------------------------------------ |
| `POSTGRES_URL`              | Primary connection URL for PostgreSQL      |
| `DATABASE_URL`              | Alternative connection URL                 |
| `PGURL`                     | Alternative connection URL                 |
| `PG_URL`                    | Alternative connection URL                 |
| `TLS_POSTGRES_DATABASE_URL` | SSL/TLS-enabled connection URL             |
| `TLS_DATABASE_URL`          | Alternative SSL/TLS-enabled connection URL |

If no connection URL is provided, the system checks for the following individual parameters:

| Environment Variable | Fallback Variables           | Default Value | Description       |
| -------------------- | ---------------------------- | ------------- | ----------------- |
| `PGHOST`             | -                            | `localhost`   | Database host     |
| `PGPORT`             | -                            | `5432`        | Database port     |
| `PGUSERNAME`         | `PGUSER`, `USER`, `USERNAME` | `postgres`    | Database user     |
| `PGPASSWORD`         | -                            | (empty)       | Database password |
| `PGDATABASE`         | -                            | username      | Database name     |

## Connection Options

You can configure your database connection manually by passing options to the SQL constructor:

```ts
import { SQL } from "bun";

const db = new SQL({
  // Required
  url: "postgres://user:pass@localhost:5432/dbname",

  // Optional configuration
  hostname: "localhost",
  port: 5432,
  database: "myapp",
  username: "dbuser",
  password: "secretpass",

  // Connection pool settings
  max: 20, // Maximum connections in pool
  idleTimeout: 30, // Close idle connections after 30s
  maxLifetime: 0, // Connection lifetime in seconds (0 = forever)
  connectionTimeout: 30, // Timeout when establishing new connections

  // SSL/TLS options
  tls: true,
  // tls: {
  //   rejectUnauthorized: true,
  //   requestCert: true,
  //   ca: "path/to/ca.pem",
  //   key: "path/to/key.pem",
  //   cert: "path/to/cert.pem",
  //   checkServerIdentity(hostname, cert) {
  //     ...
  //   },
  // },

  // Callbacks
  onconnect: client => {
    console.log("Connected to database");
  },
  onclose: client => {
    console.log("Connection closed");
  },
});
```

## Dynamic passwords

When clients need to use alternative authentication schemes such as access tokens or connections to databases with rotating passwords, provide either a synchronous or asynchronous function that will resolve the dynamic password value at connection time.

```ts
import { SQL } from "bun";

const sql = new SQL(url, {
  // Other connection config
  ...
  // Password function for the database user
  password: async () => await signer.getAuthToken(),
});
```

## Transactions

To start a new transaction, use `sql.begin`. This method reserves a dedicated connection for the duration of the transaction and provides a scoped `sql` instance to use within the callback function. Once the callback completes, `sql.begin` resolves with the return value of the callback.

The `BEGIN` command is sent automatically, including any optional configurations you specify. If an error occurs during the transaction, a `ROLLBACK` is triggered to release the reserved connection and ensure the process continues smoothly.

### Basic Transactions

```ts
await sql.begin(async tx => {
  // All queries in this function run in a transaction
  await tx`INSERT INTO users (name) VALUES (${"Alice"})`;
  await tx`UPDATE accounts SET balance = balance - 100 WHERE user_id = 1`;

  // Transaction automatically commits if no errors are thrown
  // Rolls back if any error occurs
});
```

It's also possible to pipeline the requests in a transaction if needed by returning an array with queries from the callback function like this:

```ts
await sql.begin(async tx => {
  return [
    tx`INSERT INTO users (name) VALUES (${"Alice"})`,
    tx`UPDATE accounts SET balance = balance - 100 WHERE user_id = 1`,
  ];
});
```

### Savepoints

Savepoints in SQL create intermediate checkpoints within a transaction, enabling partial rollbacks without affecting the entire operation. They are useful in complex transactions, allowing error recovery and maintaining consistent results.

```ts
await sql.begin(async tx => {
  await tx`INSERT INTO users (name) VALUES (${"Alice"})`;

  await tx.savepoint(async sp => {
    // This part can be rolled back separately
    await sp`UPDATE users SET status = 'active'`;
    if (someCondition) {
      throw new Error("Rollback to savepoint");
    }
  });

  // Continue with transaction even if savepoint rolled back
  await tx`INSERT INTO audit_log (action) VALUES ('user_created')`;
});
```

### Distributed Transactions

Two-Phase Commit (2PC) is a distributed transaction protocol where Phase 1 has the coordinator preparing nodes by ensuring data is written and ready to commit, while Phase 2 finalizes with nodes either committing or rolling back based on the coordinator's decision. This process ensures data durability and proper lock management.

In PostgreSQL and MySQL, distributed transactions persist beyond their original session, allowing privileged users or coordinators to commit or rollback them later. This supports robust distributed transactions, recovery processes, and administrative operations.

Each database system implements distributed transactions differently:

PostgreSQL natively supports them through prepared transactions, while MySQL uses XA Transactions.

If any exceptions occur during the distributed transaction and aren't caught, the system will automatically rollback all changes. When everything proceeds normally, you maintain the flexibility to either commit or rollback the transaction later.

```ts
// Begin a distributed transaction
await sql.beginDistributed("tx1", async tx => {
  await tx`INSERT INTO users (name) VALUES (${"Alice"})`;
});

// Later, commit or rollback
await sql.commitDistributed("tx1");
// or
await sql.rollbackDistributed("tx1");
```

## Authentication

Bun supports SCRAM-SHA-256 (SASL), MD5, and Clear Text authentication. SASL is recommended for better security. Check [Postgres SASL Authentication](https://www.postgresql.org/docs/current/sasl-authentication.html) for more information.

### SSL Modes Overview

PostgreSQL supports different SSL/TLS modes to control how secure connections are established. These modes determine the behavior when connecting and the level of certificate verification performed.

```ts
const sql = new SQL({
  hostname: "localhost",
  username: "user",
  password: "password",
  ssl: "disable", // | "prefer" | "require" | "verify-ca" | "verify-full"
});
```

| SSL Mode      | Description                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------- |
| `disable`     | No SSL/TLS used. Connections fail if server requires SSL.                                                            |
| `prefer`      | Tries SSL first, falls back to non-SSL if SSL fails. Default mode if none specified.                                 |
| `require`     | Requires SSL without certificate verification. Fails if SSL cannot be established.                                   |
| `verify-ca`   | Verifies server certificate is signed by trusted CA. Fails if verification fails.                                    |
| `verify-full` | Most secure mode. Verifies certificate and hostname match. Protects against untrusted certificates and MITM attacks. |

### Using With Connection Strings

The SSL mode can also be specified in connection strings:

```ts
// Using prefer mode
const sql = new SQL("postgres://user:password@localhost/mydb?sslmode=prefer");

// Using verify-full mode
const sql = new SQL(
  "postgres://user:password@localhost/mydb?sslmode=verify-full",
);
```

## Connection Pooling

Bun's SQL client automatically manages a connection pool, which is a pool of database connections that are reused for multiple queries. This helps to reduce the overhead of establishing and closing connections for each query, and it also helps to manage the number of concurrent connections to the database.

```ts
const db = new SQL({
  // Pool configuration
  max: 20, // Maximum 20 concurrent connections
  idleTimeout: 30, // Close idle connections after 30s
  maxLifetime: 3600, // Max connection lifetime 1 hour
  connectionTimeout: 10, // Connection timeout 10s
});
```

No connection will be made until a query is made.

```ts
const sql = Bun.sql(); // no connection are created

await sql`...`; // pool is started until max is reached (if possible), first available connection is used
await sql`...`; // previous connection is reused

// two connections are used now at the same time
await Promise.all([
  sql`INSERT INTO users ${sql({ name: "Alice" })}`,
  sql`UPDATE users SET name = ${user.name} WHERE id = ${user.id}`,
]);

await sql.close(); // await all queries to finish and close all connections from the pool
await sql.close({ timeout: 5 }); // wait 5 seconds and close all connections from the pool
await sql.close({ timeout: 0 }); // close all connections from the pool immediately
```

## Reserved Connections

Bun enables you to reserve a connection from the pool, and returns a client that wraps the single connection. This can be used for running queries on an isolated connection.

```ts
// Get exclusive connection from pool
const reserved = await sql.reserve();

try {
  await reserved`INSERT INTO users (name) VALUES (${"Alice"})`;
} finally {
  // Important: Release connection back to pool
  reserved.release();
}

// Or using Symbol.dispose
{
  using reserved = await sql.reserve();
  await reserved`SELECT 1`;
} // Automatically released
```

## Prepared Statements

By default, Bun's SQL client automatically creates named prepared statements for queries where it can be inferred that the query is static. This provides better performance. However, you can change this behavior by setting `prepare: false` in the connection options:

```ts
const sql = new SQL({
  // ... other options ...
  prepare: false, // Disable persisting named prepared statements on the server
});
```

When `prepare: false` is set:

Queries are still executed using the "extended" protocol, but they are executed using [unnamed prepared statements](https://www.postgresql.org/docs/current/protocol-flow.html#PROTOCOL-FLOW-EXT-QUERY), an unnamed prepared statement lasts only until the next Parse statement specifying the unnamed statement as destination is issued.

- Parameter binding is still safe against SQL injection
- Each query is parsed and planned from scratch by the server
- Queries will not be [pipelined](https://www.postgresql.org/docs/current/protocol-flow.html#PROTOCOL-FLOW-PIPELINING)

You might want to use `prepare: false` when:

- Using PGBouncer in transaction mode (though since PGBouncer 1.21.0, protocol-level named prepared statements are supported when configured properly)
- Debugging query execution plans
- Working with dynamic SQL where query plans need to be regenerated frequently
- More than one command per query will not be supported (unless you use `sql``.simple()`)

Note that disabling prepared statements may impact performance for queries that are executed frequently with different parameters, as the server needs to parse and plan each query from scratch.

## Error Handling

The client provides typed errors for different failure scenarios:

### Connection Errors

| Connection Errors                 | Description                                          |
| --------------------------------- | ---------------------------------------------------- |
| `ERR_POSTGRES_CONNECTION_CLOSED`  | Connection was terminated or never established       |
| `ERR_POSTGRES_CONNECTION_TIMEOUT` | Failed to establish connection within timeout period |
| `ERR_POSTGRES_IDLE_TIMEOUT`       | Connection closed due to inactivity                  |
| `ERR_POSTGRES_LIFETIME_TIMEOUT`   | Connection exceeded maximum lifetime                 |
| `ERR_POSTGRES_TLS_NOT_AVAILABLE`  | SSL/TLS connection not available                     |
| `ERR_POSTGRES_TLS_UPGRADE_FAILED` | Failed to upgrade connection to SSL/TLS              |

### Authentication Errors

| Authentication Errors                            | Description                              |
| ------------------------------------------------ | ---------------------------------------- |
| `ERR_POSTGRES_AUTHENTICATION_FAILED_PBKDF2`      | Password authentication failed           |
| `ERR_POSTGRES_UNKNOWN_AUTHENTICATION_METHOD`     | Server requested unknown auth method     |
| `ERR_POSTGRES_UNSUPPORTED_AUTHENTICATION_METHOD` | Server requested unsupported auth method |
| `ERR_POSTGRES_INVALID_SERVER_KEY`                | Invalid server key during authentication |
| `ERR_POSTGRES_INVALID_SERVER_SIGNATURE`          | Invalid server signature                 |
| `ERR_POSTGRES_SASL_SIGNATURE_INVALID_BASE64`     | Invalid SASL signature encoding          |
| `ERR_POSTGRES_SASL_SIGNATURE_MISMATCH`           | SASL signature verification failed       |

### Query Errors

| Query Errors                         | Description                                |
| ------------------------------------ | ------------------------------------------ |
| `ERR_POSTGRES_SYNTAX_ERROR`          | Invalid SQL syntax (extends `SyntaxError`) |
| `ERR_POSTGRES_SERVER_ERROR`          | General error from PostgreSQL server       |
| `ERR_POSTGRES_INVALID_QUERY_BINDING` | Invalid parameter binding                  |
| `ERR_POSTGRES_QUERY_CANCELLED`       | Query was cancelled                        |
| `ERR_POSTGRES_NOT_TAGGED_CALL`       | Query was called without a tagged call     |

### Data Type Errors

| Data Type Errors                                        | Description                           |
| ------------------------------------------------------- | ------------------------------------- |
| `ERR_POSTGRES_INVALID_BINARY_DATA`                      | Invalid binary data format            |
| `ERR_POSTGRES_INVALID_BYTE_SEQUENCE`                    | Invalid byte sequence                 |
| `ERR_POSTGRES_INVALID_BYTE_SEQUENCE_FOR_ENCODING`       | Encoding error                        |
| `ERR_POSTGRES_INVALID_CHARACTER`                        | Invalid character in data             |
| `ERR_POSTGRES_OVERFLOW`                                 | Numeric overflow                      |
| `ERR_POSTGRES_UNSUPPORTED_BYTEA_FORMAT`                 | Unsupported binary format             |
| `ERR_POSTGRES_UNSUPPORTED_INTEGER_SIZE`                 | Integer size not supported            |
| `ERR_POSTGRES_MULTIDIMENSIONAL_ARRAY_NOT_SUPPORTED_YET` | Multidimensional arrays not supported |
| `ERR_POSTGRES_NULLS_IN_ARRAY_NOT_SUPPORTED_YET`         | NULL values in arrays not supported   |

### Protocol Errors

| Protocol Errors                         | Description                 |
| --------------------------------------- | --------------------------- |
| `ERR_POSTGRES_EXPECTED_REQUEST`         | Expected client request     |
| `ERR_POSTGRES_EXPECTED_STATEMENT`       | Expected prepared statement |
| `ERR_POSTGRES_INVALID_BACKEND_KEY_DATA` | Invalid backend key data    |
| `ERR_POSTGRES_INVALID_MESSAGE`          | Invalid protocol message    |
| `ERR_POSTGRES_INVALID_MESSAGE_LENGTH`   | Invalid message length      |
| `ERR_POSTGRES_UNEXPECTED_MESSAGE`       | Unexpected message type     |

### Transaction Errors

| Transaction Errors                       | Description                           |
| ---------------------------------------- | ------------------------------------- |
| `ERR_POSTGRES_UNSAFE_TRANSACTION`        | Unsafe transaction operation detected |
| `ERR_POSTGRES_INVALID_TRANSACTION_STATE` | Invalid transaction state             |

## Numbers and BigInt

Bun's SQL client includes special handling for large numbers that exceed the range of a 53-bit integer. Here's how it works:

```ts
import { sql } from "bun";

const [{ x, y }] = await sql`SELECT 9223372036854777 as x, 12345 as y`;

console.log(typeof x, x); // "string" "9223372036854777"
console.log(typeof y, y); // "number" 12345
```

## BigInt Instead of Strings

If you need large numbers as BigInt instead of strings, you can enable this by setting the `bigint` option to `true` when initializing the SQL client:

```ts
const sql = new SQL({
  bigint: true,
});

const [{ x }] = await sql`SELECT 9223372036854777 as x`;

console.log(typeof x, x); // "bigint" 9223372036854777n
```

## Roadmap

There's still some things we haven't finished yet.

- Connection preloading via `--db-preconnect` Bun CLI flag
- MySQL support: [we're working on it](https://github.com/oven-sh/bun/pull/15274)
- SQLite support: planned, but not started. Ideally, we implement it natively instead of wrapping `bun:sqlite`.
- Column name transforms (e.g. `snake_case` to `camelCase`). This is mostly blocked on a unicode-aware implementation of changing the case in C++ using WebKit's `WTF::String`.
- Column type transforms

### Postgres-specific features

We haven't implemented these yet:

- `COPY` support
- `LISTEN` support
- `NOTIFY` support

We also haven't implemented some of the more uncommon features like:

- GSSAPI authentication
- `SCRAM-SHA-256-PLUS` support
- Point & PostGIS types
- All the multi-dimensional integer array types (only a couple of the types are supported)

## Frequently Asked Questions

> Why is this `Bun.sql` and not `Bun.postgres`?

The plan is to add more database drivers in the future.

> Why not just use an existing library?

npm packages like postgres.js, pg, and node-postgres can be used in Bun too. They're great options.

Two reasons why:

1. We think it's simpler for developers to have a database driver built into Bun. The time you spend library shopping is time you could be building your app.
2. We leverage some JavaScriptCore engine internals to make it faster to create objects that would be difficult to implement in a library

## Credits

Huge thanks to [@porsager](https://github.com/porsager)'s [postgres.js](https://github.com/porsager/postgres) for the inspiration for the API interface.
