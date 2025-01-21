Bun provides native bindings for working with PostgreSQL databases with a modern, Promise-based API. The interface is designed to be simple and performant, using tagged template literals for queries and offering features like connection pooling, transactions, and prepared statements.

```ts
import { sql } from "bun";

const user = {
  name: "Alice",
  email: "alice@example.com",
  age: 25,
};

const [user] = await sql`INSERT INTO users ${sql(user)} RETURNING *`;
// { id: 1, name: "Alice", email: "alice@example.com", age: 25 }
```

The API is simple and fast, Credit to [postgres.js](https://github.com/porsager/postgres) and its contributors for inspiring the API of `Bun.sql`.

Features:

- Tagged template literals automatically protect against SQL injection
- Transactions
- Parameters (named & positional)
- Automatic prepared statements
- Connection pooling
- The fastest performance of any PostgreSQL driver for JavaScript
- `bigint` support
- Authentication methods:
  - SASL (SCRAM-SHA-256) support
  - MD5
  - Clear text
- Connection timeouts
- SQL fragments
- Returning data as objects, as values (array of arrays), and raw
- Binary protocol support, improving serialization performance
- TLS support, including auth mode:
  - `require`
  - `prefer`
  - `disable`
  - `verify-ca`
  - `verify-full`
- `$DATABASE_URL` environment variable support

## Basic Select Queries

```ts
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

## Insert Operations

Insert operations in Bun's SQL client come with several helpful features to make inserting data both safe and convenient. The client provides special helpers for handling both single-row and bulk inserts.

### Single Row Insert

Single row inserts can be performed either by specifying values directly or by using the sql() helper function with objects. The helper function automatically handles field names and value escaping.

```ts
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

One of the most powerful features is the ability to insert multiple rows in a single query. This is significantly more efficient than performing multiple individual inserts, especially when dealing with large datasets.

```ts
const users = [
  { name: "Alice", email: "alice@example.com" },
  { name: "Bob", email: "bob@example.com" },
  { name: "Charlie", email: "charlie@example.com" },
];

await sql`INSERT INTO users ${sql(users)}`;
```

### Selective Column Insert

Sometimes you have objects with more properties than you want to insert into the database. The SQL helper allows you to specify exactly which columns should be included in the insert operation.

```ts
const user = {
  name: "Alice",
  email: "alice@example.com",
  age: 25,
};

await sql`INSERT INTO users ${sql(user, ["name", "email"])}`;
// Only inserts name and email columns, ignoring other fields
```

## Alternative Query Result Formats

By default, Bun's SQL client returns query results as arrays of objects, where each object represents a row with column names as keys. However, there are cases where you might want the data in a different format. The client provides two additional methods for this purpose.

### Values Format

The `.values()` method returns rows as arrays of values rather than objects. Each row becomes an array where the values are in the same order as the columns in your query.

```ts
const rows = await sql`SELECT * FROM users`.values();
console.log(rows); // [['Alice', 'alice@example.com'], ['Bob', 'bob@example.com']]
```

### Raw Format

The `.raw()` method returns rows as arrays of `Buffer` objects. This can be useful for working with binary data or for performance reasons.

```ts
const rows = await sql`SELECT * FROM users`.raw();
console.log(rows); // [[Buffer, Buffer], [Buffer, Buffer], [Buffer, Buffer]]
```

## SQL Fragments

A common need in database applications is the ability to construct queries dynamically based on runtime conditions. Bun provides safe ways to do this without risking SQL injection.

### Dynamic Table Names

When you need to reference tables or schemas dynamically, always use the sql() helper to ensure proper escaping:

```ts
// Safely reference tables dynamically
await sql`SELECT * FROM ${sql("users")}`;

// With schema qualification
await sql`SELECT * FROM ${sql("public.users")}`;
```

### Conditional Queries

One of the most powerful features is the ability to build queries with conditional clauses. This allows you to create flexible queries that adapt to your application's needs:

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

### Unsafe Queries

You can use the `sql.unsafe` function to execute raw SQL strings. Use this with caution, as it can be dangerous if you're not careful.

```ts
const result = await sql.unsafe(
  "SELECT " + columns + " FROM users WHERE id = " + id,
);
```

### Execute and Cancelling Queries

Bun's SQL is a lazy Promise that means its will only start executing when awaited or executed with `.execute()`.
You can cancel a query that is currently executing by calling the `cancel()` method on the query object.

```ts
const query = await sql`SELECT * FROM users`.execute();
setTimeout(() => query.cancel(), 100);
await query;
```

## Connection Options

You can configure your database connection by passing options to the SQL constructor:

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
  idleTimeout: 30000, // Close idle connections after 30s
  maxLifetime: 0, // Connection lifetime in ms (0 = forever)
  connectionTimeout: 30, // Timeout when establishing new connections

  // SSL/TLS options
  tls: true,

  // Callbacks
  onconnect: client => {
    console.log("Connected to database");
  },
  onclose: client => {
    console.log("Connection closed");
  },
});
```

## Database Environment Variables

SQL connection parameters can be configured using environment variables. The system checks these variables in a specific order of precedence.

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
  idleTimeout: 30000, // Close idle connections after 30s
  maxLifetime: 3600000, // Max connection lifetime 1 hour
  connectionTimeout: 10000, // Connection timeout 10s
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

Bun's SQL client includes special handling for large numbers that exceed the range of a 32-bit integer. Here’s how it works:

```ts
import { sql, SQL } from "bun";

// By default, large numbers are returned as strings
const [result] = await sql`SELECT 9223372036854777 as x`;

console.log(typeof result.x); // 'string'
console.log(result.x); // '9223372036854777';
```

## Why This Matters:

- Handling Large IDs: Useful for databases with IDs that exceed 32-bit limits.
- Precision in Calculations: Maintains accuracy in financial or mathematical computations.
- Timestamps: Facilitates working with high-resolution timestamps (microseconds/nanoseconds).
- Scientific and Statistical Data: Ideal for large datasets requiring exact values.

## Getting BigInt Instead of Strings

If you need large numbers as BigInt instead of strings, you can enable this by setting the `bigint: true` option when initializing the SQL client:

```ts
const sql = new SQL({
  bigint: true,
});

const [result] = await sql`SELECT 9223372036854777 as x`;

console.log(result.x); // 9223372036854777n;
```
