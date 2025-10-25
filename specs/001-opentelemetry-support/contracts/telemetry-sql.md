# Contract: SQL Instrumentation

**Feature**: OpenTelemetry Support for Bun
**Component**: SQL Instrumentation (bun:sqlite)
**Scope**: Database-specific telemetry instrumentation for SQL operations
**Audience**: Bun core contributors implementing SQL telemetry

**Related**: See `telemetry-context.md` for the base TelemetryContext API

# Purpose

Define SQL-specific instrumentation contracts for `bun:sqlite`, including:

- Database semantic conventions (OpenTelemetry v1.27.0+ stable)
- Span attributes and naming patterns
- Query text handling and sanitization
- Connection pool monitoring
- Metrics collection for database operations
- Error handling and status reporting

# Configuration

## BunSqlInstrumentation Configuration

**TypeScript Configuration Interface**:

```typescript
interface BunSqlInstrumentationConfig {
  /**
   * If true, attach query parameters to spans as db.query.parameter.* attributes
   * Default: false (for security and cardinality control)
   */
  enhancedDatabaseReporting?: boolean;

  /**
   * If true, include full query text in db.query.text attribute
   * If false, only db.query.summary is included
   * Default: true
   *
   * Note: Non-parameterized queries will be sanitized (literals replaced with ?)
   */
  includeQueryText?: boolean;

  /**
   * Maximum length of query text before truncation
   * Default: 2048
   */
  maxQueryTextLength?: number;

  /**
   * If true, capture connection pool metrics
   * Default: true
   */
  captureConnectionPoolMetrics?: boolean;

  /**
   * If true, inject trace context as SQL comments (sqlcommenter)
   * Default: false (opt-in for compatibility)
   *
   * Example: SELECT * FROM users /* traceparent='00-abc...' */
   */
  enableSqlCommenter?: boolean;
}
```

## Native Instrument Configuration

**Zig Configuration** (`Bun.telemetry.attach` for `type: "sql"`):

```typescript
Bun.telemetry.attach({
  type: "sql",
  name: "@opentelemetry/instrumentation-sqlite",
  version: "1.0.0",

  // Optional: Control query text capture
  captureAttributes: {
    queryText: true,       // Capture db.query.text
    queryParameters: false // Capture db.query.parameter.*
  },

  onOperationStart(id, attributes) {
    // attributes contains:
    // - operation.id, operation.timestamp
    // - db.system.name: "sqlite"
    // - db.namespace: database file path
    // - db.collection.name: table name (if single-table operation)
    // - db.operation.name: "SELECT", "INSERT", "UPDATE", etc.
    // - db.query.summary: low-cardinality query grouping
    // - db.query.text: full query (if enabled)
    // - db.query.parameter.*: query parameters (if enhancedDatabaseReporting)
  },

  onOperationEnd(id, attributes) {
    // attributes contains:
    // - operation.duration: nanoseconds
    // - db.response.returned_rows: number of rows returned
  },

  onOperationError(id, attributes) {
    // attributes contains:
    // - error.type: "SQLITE_ERROR", "SQLITE_CONSTRAINT", etc.
    // - error.message: error description
    // - db.response.status_code: SQLite error code (string)
    // - operation.duration: nanoseconds
  }
});
```

# Semantic Conventions

All attributes follow OpenTelemetry Database Semantic Conventions v1.27.0+ (stable).

## Stability Status

**Stable Attributes** (use these):

- `db.system.name`
- `db.namespace`
- `db.collection.name`
- `db.operation.name`
- `db.query.summary`
- `db.query.text`
- `db.response.status_code`
- `error.type`
- `server.address`
- `server.port`

**Experimental Attributes** (use with caution):

- `db.query.parameter.<key>` - Requires opt-in via `enhancedDatabaseReporting`
- `db.response.returned_rows` - May become stable in future versions

## Database System Identifier

**Attribute**: `db.system.name`

**Value**: `"sqlite"` (for `bun:sqlite`)

**Notes**:

- Always set to `"sqlite"` for Bun's built-in SQLite support
- This is a required attribute for all database spans

## Span Naming Pattern

Spans must follow the OpenTelemetry database span naming convention:

**Priority**:

1. **Primary**: `{db.query.summary}` if available
2. **Secondary**: `{db.operation.name} {db.collection.name}` if both available
3. **Tertiary**: `{db.collection.name}` if available
4. **Fallback**: `"sqlite"` (db.system.name)

**Examples**:

```
"SELECT users"                      // db.query.summary
"INSERT INTO users"                 // db.operation.name + db.collection.name
"users"                             // db.collection.name only
"sqlite"                            // fallback
```

## Database Attributes

### Required Attributes (onOperationStart)

| Attribute          | Type   | Example           | Notes                                    |
| ------------------ | ------ | ----------------- | ---------------------------------------- |
| `db.system.name`   | string | `"sqlite"`        | Always "sqlite" for bun:sqlite           |
| `db.namespace`     | string | `"/tmp/app.db"`   | Database file path (absolute)            |
| `operation.id`     | number | `12345678`        | Unique operation ID                      |
| `operation.timestamp` | number | `1640000000000000000` | Nanoseconds since epoch           |

### Conditionally Required Attributes

| Attribute             | Type   | Condition                     | Example                            |
| --------------------- | ------ | ----------------------------- | ---------------------------------- |
| `db.collection.name`  | string | If single-table operation     | `"users"`, `"orders"`              |
| `db.operation.name`   | string | If operation type known       | `"SELECT"`, `"INSERT"`, `"UPDATE"` |
| `db.query.summary`    | string | If query can be summarized    | `"SELECT users"`                   |
| `db.query.text`       | string | If `includeQueryText` true    | `"SELECT * FROM users WHERE id=?"` |
| `error.type`          | string | If operation fails            | `"SQLITE_ERROR"`, `"SQLITE_CONSTRAINT"` |
| `db.response.status_code` | string | If operation fails        | `"1"` (SQLITE_ERROR), `"19"` (SQLITE_CONSTRAINT) |

### Recommended Attributes

| Attribute                 | Type   | Example                           | Notes                          |
| ------------------------- | ------ | --------------------------------- | ------------------------------ |
| `db.operation.batch.size` | number | `10`                              | For batch operations (≥2)      |
| `db.stored_procedure.name`| string | `"calculate_totals"`              | SQLite user-defined functions  |

### Optional Attributes (Enhanced Reporting)

| Attribute                    | Type   | Example     | Notes                                    |
| ---------------------------- | ------ | ----------- | ---------------------------------------- |
| `db.query.parameter.<key>`   | string | `"123"`     | Requires `enhancedDatabaseReporting`     |
| `db.response.returned_rows`  | number | `42`        | Number of rows returned                  |

## Query Parameter Naming

When `enhancedDatabaseReporting: true`, query parameters are captured as:

**Positional Parameters**:

```
db.query.parameter.1 = "123"
db.query.parameter.2 = "john@example.com"
```

**Named Parameters** (SQLite `:name`, `@name`, `$name`):

```
db.query.parameter.$id = "123"
db.query.parameter.$email = "john@example.com"
```

**Security**: Never capture parameters for queries containing sensitive data (passwords, API keys, tokens)

# Query Text Handling

## Query Summary Generation

**Purpose**: Create low-cardinality grouping keys for queries

**Algorithm**:

1. Extract operation type (SELECT, INSERT, UPDATE, DELETE, etc.)
2. Extract target table/collection name(s)
3. Preserve operation sequence for multi-operation queries

**Examples**:

| Query                                    | Summary                        |
| ---------------------------------------- | ------------------------------ |
| `SELECT * FROM users WHERE id=?`         | `SELECT users`                 |
| `INSERT INTO users (name) VALUES (?)`    | `INSERT users`                 |
| `UPDATE users SET name=? WHERE id=?`     | `UPDATE users`                 |
| `INSERT INTO orders SELECT * FROM cart`  | `INSERT orders SELECT cart`    |
| `BEGIN TRANSACTION`                      | `BEGIN`                        |

**Implementation** (src/telemetry/sql.zig):

```zig
fn generateQuerySummary(query: []const u8, allocator: std.mem.Allocator) ?[]const u8 {
    // Parse query to extract operation and target
    // Return format: "{operation} {target}" or "{operation1} {target1} {operation2} {target2}"
    // Return null if parsing fails (use fallback span naming)
}
```

## Query Text Sanitization

**When Required**: Non-parameterized queries (to remove sensitive literals)

**Parameterized Queries** (no sanitization needed):

```sql
SELECT * FROM users WHERE id=? AND email=?
SELECT * FROM users WHERE id=$id AND email=:email
```

**Non-Parameterized Queries** (sanitization required):

```sql
-- Original
SELECT * FROM users WHERE id=123 AND email='john@example.com'

-- Sanitized
SELECT * FROM users WHERE id=? AND email=?
```

**Sanitization Rules**:

- Replace string literals (`'...'`, `"..."`) with `?`
- Replace numeric literals with `?`
- Replace blob literals (`X'...'`) with `?`
- Preserve SQL keywords, identifiers, and operators
- Preserve `?`, `$name`, `:name`, `@name` placeholders

**Implementation** (src/telemetry/sql.zig):

```zig
fn sanitizeQueryText(query: []const u8, allocator: std.mem.Allocator) ![]const u8 {
    // Use SQLite tokenizer or simple regex-based replacement
    // Return sanitized query with literals replaced by ?
}
```

# Span Lifecycle

## Operation Start (Query Execution Begin)

**Trigger**: Before executing SQL query

**Attributes Set**:

- `operation.id`, `operation.timestamp`
- `db.system.name` = "sqlite"
- `db.namespace` = database file path
- `db.collection.name` (if determinable)
- `db.operation.name` (if determinable)
- `db.query.summary` (if query can be parsed)
- `db.query.text` (if `includeQueryText: true`)
- `db.query.parameter.*` (if `enhancedDatabaseReporting: true`)

**Example**:

```javascript
{
  "operation.id": 12345678,
  "operation.timestamp": 1640000000000000000,
  "db.system.name": "sqlite",
  "db.namespace": "/home/user/app.db",
  "db.collection.name": "users",
  "db.operation.name": "SELECT",
  "db.query.summary": "SELECT users",
  "db.query.text": "SELECT * FROM users WHERE id=? AND status=?",
  "db.query.parameter.1": "123",
  "db.query.parameter.2": "active"
}
```

## Operation End (Query Execution Success)

**Trigger**: After query execution completes successfully

**Attributes Set**:

- `operation.duration` (nanoseconds)
- `db.response.returned_rows` (number of rows returned)

**Example**:

```javascript
{
  "operation.duration": 1234567,    // ~1.2ms
  "db.response.returned_rows": 42
}
```

## Operation Error (Query Execution Failure)

**Trigger**: When query execution fails

**Attributes Set**:

- `error.type` - SQLite error name (e.g., "SQLITE_ERROR")
- `error.message` - Human-readable error description
- `db.response.status_code` - SQLite error code as string (e.g., "1")
- `operation.duration` (nanoseconds)

**SQLite Error Type Mapping**:

| Error Code | error.type               | db.response.status_code |
| ---------- | ------------------------ | ----------------------- |
| 1          | `SQLITE_ERROR`           | `"1"`                   |
| 19         | `SQLITE_CONSTRAINT`      | `"19"`                  |
| 5          | `SQLITE_BUSY`            | `"5"`                   |
| 13         | `SQLITE_FULL`            | `"13"`                  |
| 14         | `SQLITE_CANTOPEN`        | `"14"`                  |

**Example**:

```javascript
{
  "error.type": "SQLITE_CONSTRAINT",
  "error.message": "UNIQUE constraint failed: users.email",
  "db.response.status_code": "19",
  "operation.duration": 234567
}
```

# Metrics

## Stable Metrics

### `db.client.operation.duration`

**Type**: Histogram

**Unit**: seconds (s)

**Description**: Duration of database client operations

**Requirement**: Required

**Suggested Buckets**: `[0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10]`

**Attributes**:

- `db.system.name` = "sqlite" (required)
- `db.collection.name` (conditionally required)
- `db.operation.name` (conditionally required)
- `error.type` (conditionally required if failed)

**Example**:

```typescript
// 1.2ms SELECT operation on users table
histogram.record(0.0012, {
  "db.system.name": "sqlite",
  "db.collection.name": "users",
  "db.operation.name": "SELECT"
});

// 5ms INSERT operation that failed
histogram.record(0.005, {
  "db.system.name": "sqlite",
  "db.collection.name": "orders",
  "db.operation.name": "INSERT",
  "error.type": "SQLITE_CONSTRAINT"
});
```

## Experimental Metrics

### `db.client.response.returned_rows`

**Type**: Histogram

**Unit**: {row}

**Description**: Number of rows returned by database operation

**Requirement**: Recommended

**Suggested Buckets**: `[1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000]`

**Attributes**:

- `db.system.name` = "sqlite" (required)
- `db.collection.name` (conditionally required)
- `db.operation.name` (conditionally required)

**Example**:

```typescript
// SELECT returned 42 rows
histogram.record(42, {
  "db.system.name": "sqlite",
  "db.collection.name": "users",
  "db.operation.name": "SELECT"
});
```

## Connection Pool Metrics (Future)

**Note**: SQLite in Bun does not currently use connection pooling. These metrics are defined for future compatibility when connection pooling is added.

### `db.client.connection.count`

**Type**: UpDownCounter

**Unit**: {connection}

**Description**: Number of connections in each state

**Attributes**:

- `db.client.connection.state` = "idle" | "used"
- `db.client.connection.pool.name` = pool identifier

### `db.client.connection.idle.max`

**Type**: UpDownCounter

**Unit**: {connection}

**Description**: Maximum number of idle connections allowed

### `db.client.connection.create_time`

**Type**: Histogram

**Unit**: seconds (s)

**Description**: Time to create a new connection

**Suggested Buckets**: `[0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1]`

# SQL Commenter (Trace Context Injection)

## Overview

SQL Commenter injects trace context as SQL comments, enabling database query logs to correlate with traces.

**Configuration**:

```typescript
new BunSqlInstrumentation({
  enableSqlCommenter: true // Default: false (opt-in)
})
```

## Injection Format

**W3C TraceContext Format** (recommended):

```sql
SELECT * FROM users WHERE id=?
/*traceparent='00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'*/
```

**OpenTelemetry Format** (alternative):

```sql
SELECT * FROM users WHERE id=?
/*trace_id='4bf92f3577b34da6a3ce929d0e0e4736',span_id='00f067aa0ba902b7'*/
```

## Implementation

**Injection Point**: Before executing query, append comment to query text

```zig
fn injectTraceContext(query: []const u8, span_context: SpanContext, allocator: std.mem.Allocator) ![]const u8 {
    const comment = try std.fmt.allocPrint(allocator,
        " /*traceparent='{s}-{s}-{s}-{x:02}'*/",
        .{ "00", span_context.trace_id, span_context.span_id, span_context.trace_flags }
    );
    return try std.mem.concat(allocator, u8, &[_][]const u8{ query, comment });
}
```

**Security**:

- Only inject if `enableSqlCommenter: true`
- Only inject for SELECT, INSERT, UPDATE, DELETE (not for PRAGMA, schema DDL)
- Sanitize trace IDs to prevent SQL injection

# Implementation Details

## Zig Instrumentation Points

### File: `src/bun.js/bindings/sqlite/Statement.zig`

**Insertion Points**:

1. **Operation Start** - Before `sqlite3_step()`:

```zig
pub fn run(this: *Statement, globalObject: *JSGlobalObject) JSValue {
    const op_id = if (bun.telemetry.enabled()) |otel| blk: {
        const attrs = buildSqlStartAttributes(globalObject, this);
        break :blk otel.notifyOperationStart(.sql, attrs);
    } else null;
    defer if (op_id) |id| notifySqlEnd(id, globalObject, this);

    const result = sqlite3_step(this.stmt);
    // ...
}
```

2. **Operation End** - After `sqlite3_step()` success:

```zig
fn notifySqlEnd(op_id: OpId, globalObject: *JSGlobalObject, stmt: *Statement) void {
    const otel = bun.telemetry.enabled() orelse return;

    var attrs = AttributeMap.init(globalObject.allocator());
    defer attrs.deinit();

    attrs.set("db.response.returned_rows", JSValue.jsNumber(@as(f64, @floatFromInt(stmt.row_count))));

    otel.notifyOperationEnd(.sql, op_id, attrs.toJS());
}
```

3. **Operation Error** - On SQLite error:

```zig
fn notifySqlError(op_id: OpId, globalObject: *JSGlobalObject, error_code: c_int, error_msg: []const u8) void {
    const otel = bun.telemetry.enabled() orelse return;

    var attrs = AttributeMap.init(globalObject.allocator());
    defer attrs.deinit();

    attrs.set("error.type", sqliteErrorName(error_code).toJS(globalObject));
    attrs.set("error.message", ZigString.init(error_msg).toJS(globalObject));
    attrs.set("db.response.status_code", ZigString.init(&std.fmt.bufPrint(&buf, "{d}", .{error_code})).toJS(globalObject));

    otel.notifyOperationError(.sql, op_id, attrs.toJS());
}
```

### Memory Considerations

**Statement Context Storage**:

```zig
pub const Statement = struct {
    // Existing fields...

    /// Telemetry tracking (16 bytes)
    telemetry_op_id: OpId = 0,
    telemetry_start_time_ns: u64 = 0,
};
```

**Size Impact**:

- 16 bytes per prepared statement
- No heap allocations during query execution
- Stack-allocated `AttributeMap` in notification functions

## Zero-Overhead When Disabled

```zig
// This code:
if (bun.telemetry.enabled()) |otel| {
    notifySqlStart(&stmt.telemetry, globalObject, query, params);
}

// Compiles to (when disabled):
if (false) {
    // Dead code, completely eliminated by optimizer
}

// Which optimizes to:
// (nothing - zero instructions)
```

**Performance Target**: <0.1% overhead when telemetry disabled

# Expected Behavior

## Basic Query Lifecycle

### 1. Simple SELECT Query

**Query**:

```javascript
const db = new Database("app.db");
const result = db.query("SELECT * FROM users WHERE id=?").get(123);
```

**onOperationStart Attributes**:

```javascript
{
  "operation.id": 12345678,
  "operation.timestamp": 1640000000000000000,
  "db.system.name": "sqlite",
  "db.namespace": "/home/user/app.db",
  "db.collection.name": "users",
  "db.operation.name": "SELECT",
  "db.query.summary": "SELECT users",
  "db.query.text": "SELECT * FROM users WHERE id=?",
  "db.query.parameter.1": "123"  // if enhancedDatabaseReporting: true
}
```

**onOperationEnd Attributes**:

```javascript
{
  "operation.duration": 1234567,    // ~1.2ms
  "db.response.returned_rows": 1
}
```

### 2. INSERT Operation

**Query**:

```javascript
db.query("INSERT INTO users (name, email) VALUES (?, ?)").run("John", "john@example.com");
```

**onOperationStart Attributes**:

```javascript
{
  "operation.id": 12345679,
  "operation.timestamp": 1640000001000000000,
  "db.system.name": "sqlite",
  "db.namespace": "/home/user/app.db",
  "db.collection.name": "users",
  "db.operation.name": "INSERT",
  "db.query.summary": "INSERT users",
  "db.query.text": "INSERT INTO users (name, email) VALUES (?, ?)"
}
```

**onOperationEnd Attributes**:

```javascript
{
  "operation.duration": 567890,
  "db.response.returned_rows": 0  // No rows returned for INSERT
}
```

### 3. Constraint Error

**Query**:

```javascript
// Duplicate email violates UNIQUE constraint
db.query("INSERT INTO users (email) VALUES (?)").run("existing@example.com");
```

**onOperationError Attributes**:

```javascript
{
  "error.type": "SQLITE_CONSTRAINT",
  "error.message": "UNIQUE constraint failed: users.email",
  "db.response.status_code": "19",
  "operation.duration": 123456
}
```

## Complex Query Examples

### 1. Multi-Table Join

**Query**:

```sql
SELECT u.name, o.total
FROM users u
JOIN orders o ON u.id = o.user_id
WHERE o.status=?
```

**Attributes**:

```javascript
{
  "db.operation.name": "SELECT",
  "db.query.summary": "SELECT users",  // Primary table
  "db.query.text": "SELECT u.name, o.total FROM users u JOIN orders o ON u.id = o.user_id WHERE o.status=?"
}
```

**Note**: `db.collection.name` omitted (multi-table operation)

### 2. Batch Insert

**Query**:

```javascript
const insert = db.prepare("INSERT INTO users (name) VALUES (?)");
const insertMany = db.transaction((users) => {
  for (const user of users) insert.run(user.name);
});
insertMany([{name: "Alice"}, {name: "Bob"}, {name: "Charlie"}]);
```

**Attributes**:

```javascript
{
  "db.operation.name": "INSERT",
  "db.operation.batch.size": 3,
  "db.query.summary": "INSERT users"
}
```

### 3. Non-Parameterized Query (Sanitization)

**Query**:

```javascript
// BAD PRACTICE - for demonstration only
const email = "john@example.com";
db.query(`SELECT * FROM users WHERE email='${email}'`).all();
```

**Attributes**:

```javascript
{
  "db.query.text": "SELECT * FROM users WHERE email=?",  // Sanitized
  "db.query.summary": "SELECT users"
}
```

# Configuration Properties

## Environment Variables

| Variable                               | Type    | Default | Description                                         |
| -------------------------------------- | ------- | ------- | --------------------------------------------------- |
| `BUN_OTEL_SQL_INCLUDE_QUERY_TEXT`      | boolean | `true`  | Include full query text in db.query.text           |
| `BUN_OTEL_SQL_ENHANCED_REPORTING`      | boolean | `false` | Include query parameters in db.query.parameter.*   |
| `BUN_OTEL_SQL_MAX_QUERY_TEXT_LENGTH`   | number  | `2048`  | Maximum query text length before truncation        |
| `BUN_OTEL_SQL_CAPTURE_POOL_METRICS`    | boolean | `true`  | Capture connection pool metrics (future)            |
| `BUN_OTEL_SQL_ENABLE_SQL_COMMENTER`    | boolean | `false` | Inject trace context as SQL comments                |

**Example**:

```bash
export BUN_OTEL_SQL_INCLUDE_QUERY_TEXT="true"
export BUN_OTEL_SQL_ENHANCED_REPORTING="false"
export BUN_OTEL_SQL_MAX_QUERY_TEXT_LENGTH="4096"
```

# Test Cases

## TypeScript Test Cases (test/js/bun/telemetry/)

### Test: Basic SELECT Query

```typescript
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";

test("SQL instrumentation captures SELECT query", () => {
  let startAttrs: any;
  let endAttrs: any;

  Bun.telemetry.attach({
    type: "sql",
    name: "test",
    version: "1.0.0",
    onOperationStart(id, attributes) {
      startAttrs = attributes;
    },
    onOperationEnd(id, attributes) {
      endAttrs = attributes;
    },
  });

  const db = new Database(":memory:");
  db.query("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)").run();
  db.query("INSERT INTO users (name) VALUES (?)").run("Alice");

  const result = db.query("SELECT * FROM users WHERE id=?").get(1);

  expect(startAttrs).toMatchObject({
    "db.system.name": "sqlite",
    "db.collection.name": "users",
    "db.operation.name": "SELECT",
    "db.query.summary": "SELECT users",
    "operation.id": expect.any(Number),
  });

  expect(endAttrs).toMatchObject({
    "db.response.returned_rows": 1,
    "operation.duration": expect.any(Number),
  });
});
```

### Test: Query Parameter Capture

```typescript
test("Enhanced reporting captures query parameters", () => {
  let startAttrs: any;

  Bun.telemetry.attach({
    type: "sql",
    name: "test",
    version: "1.0.0",
    captureAttributes: {
      queryParameters: true,
    },
    onOperationStart(id, attributes) {
      startAttrs = attributes;
    },
  });

  const db = new Database(":memory:");
  db.query("CREATE TABLE users (id INTEGER, email TEXT)").run();
  db.query("INSERT INTO users VALUES (?, ?)").run(123, "test@example.com");

  expect(startAttrs["db.query.parameter.1"]).toBe("123");
  expect(startAttrs["db.query.parameter.2"]).toBe("test@example.com");
});
```

### Test: Constraint Error

```typescript
test("SQL instrumentation captures constraint errors", () => {
  let errorAttrs: any;

  Bun.telemetry.attach({
    type: "sql",
    name: "test",
    version: "1.0.0",
    onOperationError(id, attributes) {
      errorAttrs = attributes;
    },
  });

  const db = new Database(":memory:");
  db.query("CREATE TABLE users (email TEXT UNIQUE)").run();
  db.query("INSERT INTO users VALUES (?)").run("test@example.com");

  try {
    db.query("INSERT INTO users VALUES (?)").run("test@example.com");
  } catch (err) {
    // Expected constraint violation
  }

  expect(errorAttrs).toMatchObject({
    "error.type": "SQLITE_CONSTRAINT",
    "error.message": expect.stringContaining("UNIQUE constraint failed"),
    "db.response.status_code": "19",
    "operation.duration": expect.any(Number),
  });
});
```

### Test: Query Sanitization

```typescript
test("Non-parameterized queries are sanitized", () => {
  let startAttrs: any;

  Bun.telemetry.attach({
    type: "sql",
    name: "test",
    version: "1.0.0",
    onOperationStart(id, attributes) {
      startAttrs = attributes;
    },
  });

  const db = new Database(":memory:");
  db.query("CREATE TABLE users (id INTEGER, name TEXT)").run();

  // Non-parameterized query
  db.query("SELECT * FROM users WHERE id=123 AND name='Alice'").all();

  // Query text should be sanitized
  expect(startAttrs["db.query.text"]).toBe("SELECT * FROM users WHERE id=? AND name=?");
});
```

### Test: Batch Operations

```typescript
test("Batch operations include batch size", () => {
  let startAttrs: any;

  Bun.telemetry.attach({
    type: "sql",
    name: "test",
    version: "1.0.0",
    onOperationStart(id, attributes) {
      startAttrs = attributes;
    },
  });

  const db = new Database(":memory:");
  db.query("CREATE TABLE users (name TEXT)").run();

  const insert = db.prepare("INSERT INTO users VALUES (?)");
  const insertMany = db.transaction((users) => {
    for (const user of users) insert.run(user);
  });

  insertMany(["Alice", "Bob", "Charlie"]);

  expect(startAttrs["db.operation.batch.size"]).toBe(3);
});
```

## Integration Test Cases (packages/bun-otel/test/)

### Test: Full OpenTelemetry Integration

```typescript
import { trace } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { BunSqlInstrumentation } from "bun-otel";
import { Database } from "bun:sqlite";

test("creates SQL span with correct attributes", async () => {
  const provider = new NodeTracerProvider();
  const exporter = new InMemorySpanExporter();
  provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
  provider.register();

  const instrumentation = new BunSqlInstrumentation();
  instrumentation.enable();

  const db = new Database(":memory:");
  db.query("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)").run();
  db.query("INSERT INTO users (name) VALUES (?)").run("Alice");

  const result = db.query("SELECT * FROM users WHERE id=?").get(1);

  const spans = exporter.getFinishedSpans();
  expect(spans).toHaveLength(3); // CREATE, INSERT, SELECT

  const selectSpan = spans[2];
  expect(selectSpan.name).toBe("SELECT users");
  expect(selectSpan.kind).toBe(SpanKind.CLIENT);
  expect(selectSpan.attributes).toMatchObject({
    "db.system.name": "sqlite",
    "db.collection.name": "users",
    "db.operation.name": "SELECT",
    "db.query.summary": "SELECT users",
  });
});
```

# Related Documents

- `specs/001-opentelemetry-support/contracts/telemetry-context.md` - Base TelemetryContext API
- `specs/001-opentelemetry-support/contracts/bun-telemetry-api.md` - Public Bun.telemetry API
- `specs/001-opentelemetry-support/contracts/hook-lifecycle.md` - Hook specifications
- `specs/001-opentelemetry-support/contracts/telemetry-http.md` - HTTP instrumentation (for comparison)

# References

- [OpenTelemetry Database Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/database/)
- [OpenTelemetry SQL Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/database/sql/)
- [OpenTelemetry Database Metrics](https://opentelemetry.io/docs/specs/semconv/database/database-metrics/)
- [OpenTelemetry Database Spans](https://opentelemetry.io/docs/specs/semconv/database/database-spans/)
- [SQLite Error Codes](https://www.sqlite.org/rescode.html)
- [SQL Commenter Specification](https://google.github.io/sqlcommenter/)
- [MySQL Instrumentation (Reference Implementation)](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/packages/instrumentation-mysql)
