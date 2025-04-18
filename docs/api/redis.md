Bun provides native bindings for working with Redis databases with a modern, Promise-based API. The interface is designed to be simple and performant, with built-in connection management, fully typed responses, and TLS support. **New in Bun v1.2.9**

```ts
import { redis } from "bun";

// Set a key
await redis.set("greeting", "Hello from Bun!");

// Get a key
const greeting = await redis.get("greeting");
console.log(greeting); // "Hello from Bun!"

// Increment a counter
await redis.set("counter", 0);
await redis.incr("counter");

// Check if a key exists
const exists = await redis.exists("greeting");

// Delete a key
await redis.del("greeting");
```

## Getting Started

To use the Redis client, you first need to create a connection:

```ts
import { redis, RedisClient } from "bun";

// Using the default client (reads connection info from environment)
// process.env.REDIS_URL is used by default
await redis.set("hello", "world");
const result = await redis.get("hello");

// Creating a custom client
const client = new RedisClient("redis://username:password@localhost:6379");
await client.set("counter", "0");
await client.incr("counter");
```

By default, the client reads connection information from the following environment variables (in order of precedence):

- `REDIS_URL`
- If not set, defaults to `"redis://localhost:6379"`

### Connection Lifecycle

The Redis client automatically handles connections in the background:

```ts
// No connection is made until a command is executed
const client = new RedisClient();

// First command initiates the connection
await client.set("key", "value");

// Connection remains open for subsequent commands
await client.get("key");

// Explicitly close the connection when done
client.close();
```

You can also manually control the connection lifecycle:

```ts
const client = new RedisClient();

// Explicitly connect
await client.connect();

// Run commands
await client.set("key", "value");

// Disconnect when done
client.close();
```

## Basic Operations

### String Operations

```ts
// Set a key
await redis.set("user:1:name", "Alice");

// Get a key
const name = await redis.get("user:1:name");

// Delete a key
await redis.del("user:1:name");

// Check if a key exists
const exists = await redis.exists("user:1:name");

// Set expiration (in seconds)
await redis.set("session:123", "active");
await redis.expire("session:123", 3600); // expires in 1 hour

// Get time to live (in seconds)
const ttl = await redis.ttl("session:123");
```

### Numeric Operations

```ts
// Set initial value
await redis.set("counter", "0");

// Increment by 1
await redis.incr("counter");

// Decrement by 1
await redis.decr("counter");
```

### Hash Operations

```ts
// Set multiple fields in a hash
await redis.hmset("user:123", [
  "name",
  "Alice",
  "email",
  "alice@example.com",
  "active",
  "true",
]);

// Get multiple fields from a hash
const userFields = await redis.hmget("user:123", ["name", "email"]);
console.log(userFields); // ["Alice", "alice@example.com"]

// Increment a numeric field in a hash
await redis.hincrby("user:123", "visits", 1);

// Increment a float field in a hash
await redis.hincrbyfloat("user:123", "score", 1.5);
```

### Set Operations

```ts
// Add member to set
await redis.sadd("tags", "javascript");

// Remove member from set
await redis.srem("tags", "javascript");

// Check if member exists in set
const isMember = await redis.sismember("tags", "javascript");

// Get all members of a set
const allTags = await redis.smembers("tags");

// Get a random member
const randomTag = await redis.srandmember("tags");

// Pop (remove and return) a random member
const poppedTag = await redis.spop("tags");
```

## Advanced Usage

### Command Execution and Pipelining

The client automatically pipelines commands, improving performance by sending multiple commands in a batch and processing responses as they arrive.

```ts
// Commands are automatically pipelined by default
const [infoResult, listResult] = await Promise.all([
  redis.get("user:1:name"),
  redis.get("user:2:email"),
]);
```

To disable automatic pipelining, you can set the `enableAutoPipelining` option to `false`:

```ts
const client = new RedisClient("redis://localhost:6379", {
  enableAutoPipelining: false,
});
```

### Raw Commands

When you need to use commands that don't have convenience methods, you can use the `send` method:

```ts
// Run any Redis command
const info = await redis.send("INFO", []);

// LPUSH to a list
await redis.send("LPUSH", ["mylist", "value1", "value2"]);

// Get list range
const list = await redis.send("LRANGE", ["mylist", "0", "-1"]);
```

The `send` method allows you to use any Redis command, even ones that don't have dedicated methods in the client. The first argument is the command name, and the second argument is an array of string arguments.

### Connection Events

You can register handlers for connection events:

```ts
const client = new RedisClient();

// Called when successfully connected to Redis server
client.onconnect = () => {
  console.log("Connected to Redis server");
};

// Called when disconnected from Redis server
client.onclose = error => {
  console.error("Disconnected from Redis server:", error);
};

// Manually connect/disconnect
await client.connect();
client.close();
```

### Connection Status and Monitoring

```ts
// Check if connected
console.log(client.connected); // boolean indicating connection status

// Check amount of data buffered (in bytes)
console.log(client.bufferedAmount);
```

### Type Conversion

The Redis client handles automatic type conversion for Redis responses:

- Integer responses are returned as JavaScript numbers
- Bulk strings are returned as JavaScript strings
- Simple strings are returned as JavaScript strings
- Null bulk strings are returned as `null`
- Array responses are returned as JavaScript arrays
- Error responses throw JavaScript errors with appropriate error codes
- Boolean responses (RESP3) are returned as JavaScript booleans
- Map responses (RESP3) are returned as JavaScript objects
- Set responses (RESP3) are returned as JavaScript arrays

Special handling for specific commands:

- `EXISTS` returns a boolean instead of a number (1 becomes true, 0 becomes false)
- `SISMEMBER` returns a boolean (1 becomes true, 0 becomes false)

The following commands disable automatic pipelining:

- `AUTH`
- `INFO`
- `QUIT`
- `EXEC`
- `MULTI`
- `WATCH`
- `SCRIPT`
- `SELECT`
- `CLUSTER`
- `DISCARD`
- `UNWATCH`
- `PIPELINE`
- `SUBSCRIBE`
- `UNSUBSCRIBE`
- `UNPSUBSCRIBE`

## Connection Options

When creating a client, you can pass various options to configure the connection:

```ts
const client = new RedisClient("redis://localhost:6379", {
  // Connection timeout in milliseconds (default: 10000)
  connectionTimeout: 5000,

  // Idle timeout in milliseconds (default: 0 = no timeout)
  idleTimeout: 30000,

  // Whether to automatically reconnect on disconnection (default: true)
  autoReconnect: true,

  // Maximum number of reconnection attempts (default: 10)
  maxRetries: 10,

  // Whether to queue commands when disconnected (default: true)
  enableOfflineQueue: true,

  // Whether to automatically pipeline commands (default: true)
  enableAutoPipelining: true,

  // TLS options (default: false)
  tls: true,
  // Alternatively, provide custom TLS config:
  // tls: {
  //   rejectUnauthorized: true,
  //   ca: "path/to/ca.pem",
  //   cert: "path/to/cert.pem",
  //   key: "path/to/key.pem",
  // }
});
```

### Reconnection Behavior

When a connection is lost, the client automatically attempts to reconnect with exponential backoff:

1. The client starts with a small delay (50ms) and doubles it with each attempt
2. Reconnection delay is capped at 2000ms (2 seconds)
3. The client attempts to reconnect up to `maxRetries` times (default: 10)
4. Commands executed during disconnection are:
   - Queued if `enableOfflineQueue` is true (default)
   - Rejected immediately if `enableOfflineQueue` is false

## Supported URL Formats

The Redis client supports various URL formats:

```ts
// Standard Redis URL
new RedisClient("redis://localhost:6379");
new RedisClient("redis://localhost:6379");

// With authentication
new RedisClient("redis://username:password@localhost:6379");

// With database number
new RedisClient("redis://localhost:6379/0");

// TLS connections
new RedisClient("rediss://localhost:6379");
new RedisClient("rediss://localhost:6379");
new RedisClient("redis+tls://localhost:6379");
new RedisClient("redis+tls://localhost:6379");

// Unix socket connections
new RedisClient("redis+unix:///path/to/socket");
new RedisClient("redis+unix:///path/to/socket");

// TLS over Unix socket
new RedisClient("redis+tls+unix:///path/to/socket");
new RedisClient("redis+tls+unix:///path/to/socket");
```

## Error Handling

The Redis client throws typed errors for different scenarios:

```ts
try {
  await redis.get("non-existent-key");
} catch (error) {
  if (error.code === "ERR_REDIS_CONNECTION_CLOSED") {
    console.error("Connection to Redis server was closed");
  } else if (error.code === "ERR_REDIS_AUTHENTICATION_FAILED") {
    console.error("Authentication failed");
  } else {
    console.error("Unexpected error:", error);
  }
}
```

Common error codes:

- `ERR_REDIS_CONNECTION_CLOSED` - Connection to the server was closed
- `ERR_REDIS_AUTHENTICATION_FAILED` - Failed to authenticate with the server
- `ERR_REDIS_INVALID_RESPONSE` - Received an invalid response from the server

## Example Use Cases

### Caching

```ts
async function getUserWithCache(userId) {
  const cacheKey = `user:${userId}`;

  // Try to get from cache first
  const cachedUser = await redis.get(cacheKey);
  if (cachedUser) {
    return JSON.parse(cachedUser);
  }

  // Not in cache, fetch from database
  const user = await database.getUser(userId);

  // Store in cache for 1 hour
  await redis.set(cacheKey, JSON.stringify(user));
  await redis.expire(cacheKey, 3600);

  return user;
}
```

### Rate Limiting

```ts
async function rateLimit(ip, limit = 100, windowSecs = 3600) {
  const key = `ratelimit:${ip}`;

  // Increment counter
  const count = await redis.incr(key);

  // Set expiry if this is the first request in window
  if (count === 1) {
    await redis.expire(key, windowSecs);
  }

  // Check if limit exceeded
  return {
    limited: count > limit,
    remaining: Math.max(0, limit - count),
  };
}
```

### Session Storage

```ts
async function createSession(userId, data) {
  const sessionId = crypto.randomUUID();
  const key = `session:${sessionId}`;

  // Store session with expiration
  await redis.hmset(key, [
    "userId",
    userId.toString(),
    "created",
    Date.now().toString(),
    "data",
    JSON.stringify(data),
  ]);
  await redis.expire(key, 86400); // 24 hours

  return sessionId;
}

async function getSession(sessionId) {
  const key = `session:${sessionId}`;

  // Get session data
  const exists = await redis.exists(key);
  if (!exists) return null;

  const [userId, created, data] = await redis.hmget(key, [
    "userId",
    "created",
    "data",
  ]);

  return {
    userId: Number(userId),
    created: Number(created),
    data: JSON.parse(data),
  };
}
```

## Implementation Notes

Bun's Redis client is implemented in Zig and uses the Redis Serialization Protocol (RESP3). It manages connections efficiently and provides automatic reconnection with exponential backoff.

The client supports pipelining commands, meaning multiple commands can be sent without waiting for the replies to previous commands. This significantly improves performance when sending multiple commands in succession.

### RESP3 Protocol Support

Bun's Redis client uses the newer RESP3 protocol by default, which provides more data types and features compared to RESP2:

- Better error handling with typed errors
- Native Boolean responses
- Map/Dictionary responses (key-value objects)
- Set responses
- Double (floating point) values
- BigNumber support for large integer values

When connecting to Redis servers using older versions that don't support RESP3, the client automatically fallbacks to compatible modes.

## Limitations and Future Plans

Current limitations of the Redis client we are planning to address in future versions:

- [ ] No dedicated API for pub/sub functionality (though you can use the raw command API)
- [ ] Transactions (MULTI/EXEC) must be done through raw commands for now
- [ ] Streams are supported but without dedicated methods

Unsupported features:

- Redis Sentinel
- Redis Cluster
