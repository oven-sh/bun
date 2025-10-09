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

// Get a key as Uint8Array
const buffer = await redis.getBuffer("user:1:name");

// Delete a key
await redis.del("user:1:name");

// Check if a key exists
const exists = await redis.exists("user:1:name");

// Set expiration (in seconds)
await redis.set("session:123", "active");
await redis.expire("session:123", 3600); // expires in 1 hour

// Get time to live (in seconds)
const ttl = await redis.ttl("session:123");

// Set if not exists
await redis.setnx("lock", "token");

// Set with expiration (seconds)
await redis.setex("temp", 60, "value");

// Set with expiration (milliseconds)
await redis.psetex("temp", 5000, "value");

// Get and set in one operation
const oldValue = await redis.getset("key", "new-value");

// Get and delete
const value = await redis.getdel("key");

// Get and set expiration
const currentValue = await redis.getex("key", "EX", 60);

// Get multiple keys
const values = await redis.mget(["key1", "key2", "key3"]);

// Set multiple keys
await redis.mset(["key1", "value1", "key2", "value2"]);

// Set multiple keys if none exist
const success = await redis.msetnx(["key1", "value1", "key2", "value2"]);

// Append to a string
await redis.append("log", "new entry\n");

// Get string length
const length = await redis.strlen("key");

// Set expiration at specific timestamp (seconds)
await redis.expireat("key", Math.floor(Date.now() / 1000) + 3600);

// Set expiration (milliseconds)
await redis.pexpire("key", 60000);

// Set expiration at specific timestamp (milliseconds)
await redis.pexpireat("key", Date.now() + 60000);

// Get expiration timestamp (seconds)
const expiresAt = await redis.expiretime("key");

// Get expiration timestamp (milliseconds)
const expiresAtMs = await redis.pexpiretime("key");

// Get time to live (milliseconds)
const ttlMs = await redis.pttl("key");

// Remove expiration
await redis.persist("key");

// Get bit value at offset
const bit = await redis.getbit("key", 7);

// Set bit value at offset
await redis.setbit("key", 7, 1);

// Count set bits
const count = await redis.bitcount("key");

// Get substring
const substring = await redis.getrange("key", 0, 10);

// Set substring
await redis.setrange("key", 5, "replacement");

// Copy key
await redis.copy("source", "destination");

// Rename key
await redis.rename("old-key", "new-key");

// Rename if new key doesn't exist
const renamed = await redis.renamenx("old-key", "new-key");

// Delete key asynchronously
await redis.unlink("key");

// Update last access time
await redis.touch("key1", "key2");

// Serialize value
const serialized = await redis.dump("key");
```

### Numeric Operations

```ts
// Set initial value
await redis.set("counter", "0");

// Increment by 1
await redis.incr("counter");

// Decrement by 1
await redis.decr("counter");

// Increment by a specific value
await redis.incrby("counter", 5);

// Decrement by a specific value
await redis.decrby("counter", 3);

// Increment by a float value
await redis.incrbyfloat("counter", 2.5);
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

// Get single field from hash (returns value directly, null if missing)
const userName = await redis.hget("user:123", "name");
console.log(userName); // "Alice"

// Increment a numeric field in a hash
await redis.hincrby("user:123", "visits", 1);

// Increment a float field in a hash
await redis.hincrbyfloat("user:123", "score", 1.5);

// Set a single field
await redis.hset("user:123", "name", "Bob");

// Set field if it doesn't exist
const created = await redis.hsetnx("user:123", "id", "123");

// Delete fields
await redis.hdel("user:123", "email", "phone");

// Check if field exists
const hasEmail = await redis.hexists("user:123", "email");

// Get all fields and values
const allData = await redis.hgetall("user:123");

// Get all field names
const fields = await redis.hkeys("user:123");

// Get all values
const values = await redis.hvals("user:123");

// Get number of fields
const fieldCount = await redis.hlen("user:123");

// Get string length of field value
const nameLength = await redis.hstrlen("user:123", "name");

// Get random field(s)
const randomField = await redis.hrandfield("user:123");
const randomFields = await redis.hrandfield("user:123", 2);

// Scan hash fields
const [cursor, fields] = await redis.hscan("user:123", 0);
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

// Get set size
const size = await redis.scard("tags");

// Move member between sets
await redis.smove("source-set", "dest-set", "member");

// Check multiple members
const results = await redis.smismember("tags", ["javascript", "python", "rust"]);

// Difference between sets
const diff = await redis.sdiff("set1", "set2");

// Store difference in new set
await redis.sdiffstore("result", "set1", "set2");

// Intersection of sets
const intersection = await redis.sinter("set1", "set2");

// Count intersection
const intersectionCount = await redis.sintercard("set1", "set2");

// Store intersection in new set
await redis.sinterstore("result", "set1", "set2");

// Union of sets
const union = await redis.sunion("set1", "set2");

// Store union in new set
await redis.sunionstore("result", "set1", "set2");

// Scan set members
const [cursor, members] = await redis.sscan("tags", 0);
```

### Sorted Set Operations

```ts
// Add members with scores
await redis.zadd("leaderboard", 100, "player1");
await redis.zadd("leaderboard", 200, "player2", 150, "player3");

// Remove members
await redis.zrem("leaderboard", "player1");

// Get number of members
const count = await redis.zcard("leaderboard");

// Count members in score range
const rangeCount = await redis.zcount("leaderboard", 100, 200);

// Get member score
const score = await redis.zscore("leaderboard", "player1");

// Get multiple scores
const scores = await redis.zmscore("leaderboard", ["player1", "player2"]);

// Get member rank (0-based, lowest to highest)
const rank = await redis.zrank("leaderboard", "player1");

// Get member rank (0-based, highest to lowest)
const revRank = await redis.zrevrank("leaderboard", "player1");

// Increment member score
await redis.zincrby("leaderboard", 10, "player1");

// Get range by index
const topPlayers = await redis.zrange("leaderboard", 0, 9);

// Get range by index (reverse order)
const topPlayersDesc = await redis.zrevrange("leaderboard", 0, 9);

// Get range by score
const players = await redis.zrangebyscore("leaderboard", 100, 200);

// Get range by score (reverse)
const playersDesc = await redis.zrevrangebyscore("leaderboard", 200, 100);

// Get range by lexicographic order
const names = await redis.zrangebylex("names", "[a", "[z");

// Get range by lex (reverse)
const namesRev = await redis.zrevrangebylex("names", "[z", "[a");

// Count members in lex range
const lexCount = await redis.zlexcount("names", "[a", "[z");

// Store range result
await redis.zrangestore("result", "leaderboard", 0, 9);

// Remove members by lex range
await redis.zremrangebylex("names", "[a", "[c");

// Remove members by rank
await redis.zremrangebyrank("leaderboard", 0, 9);

// Remove members by score
await redis.zremrangebyscore("leaderboard", 0, 100);

// Pop member with lowest score
const lowest = await redis.zpopmin("leaderboard");

// Pop member with highest score
const highest = await redis.zpopmax("leaderboard");

// Blocking pop lowest
const [key, member, score] = await redis.bzpopmin("leaderboard", 5);

// Blocking pop highest
const [key, member, score] = await redis.bzpopmax("leaderboard", 5);

// Pop from multiple sorted sets
const popped = await redis.zmpop("leaderboard1", "leaderboard2");

// Blocking pop from multiple sorted sets
const blockedPop = await redis.bzmpop(5, "leaderboard1", "leaderboard2");

// Difference between sorted sets
const diff = await redis.zdiff("set1", "set2");

// Store difference
await redis.zdiffstore("result", "set1", "set2");

// Intersection of sorted sets
const intersection = await redis.zinter("set1", "set2");

// Count intersection
const interCount = await redis.zintercard("set1", "set2");

// Store intersection
await redis.zinterstore("result", "set1", "set2");

// Union of sorted sets
const union = await redis.zunion("set1", "set2");

// Store union
await redis.zunionstore("result", "set1", "set2");

// Get random member(s)
const random = await redis.zrandmember("leaderboard");
const randomWithScores = await redis.zrandmember("leaderboard", 3, true);

// Scan sorted set
const [cursor, members] = await redis.zscan("leaderboard", 0);
```

### List Operations

```ts
// Push to left (head)
await redis.lpush("queue", "item1");

// Push to right (tail)
await redis.rpush("queue", "item2");

// Pop from left
const leftItem = await redis.lpop("queue");

// Pop from right
const rightItem = await redis.rpop("queue");

// Push to left if list exists
await redis.lpushx("queue", "item");

// Push to right if list exists
await redis.rpushx("queue", "item");

// Get list length
const length = await redis.llen("queue");

// Get range of elements
const items = await redis.lrange("queue", 0, -1);

// Get element by index
const item = await redis.lindex("queue", 0);

// Set element by index
await redis.lset("queue", 0, "new-value");

// Insert before/after element
await redis.linsert("queue", "BEFORE", "pivot", "new-item");

// Remove elements
await redis.lrem("queue", 2, "value"); // remove first 2 occurrences

// Trim list to range
await redis.ltrim("queue", 0, 99);

// Find position of element
const position = await redis.lpos("queue", "item");

// Move element between lists
await redis.lmove("source", "dest", "LEFT", "RIGHT");

// Pop from multiple lists
const popped = await redis.lmpop("list1", "list2", "LEFT");

// Pop from right, push to left (atomic)
await redis.rpoplpush("source", "dest");

// Blocking pop from left
const [key, value] = await redis.blpop("queue", 5);

// Blocking pop from right
const [key, value] = await redis.brpop("queue", 5);

// Blocking move
await redis.blmove("source", "dest", "LEFT", "RIGHT", 5);

// Blocking pop from multiple lists
const result = await redis.blmpop(5, "list1", "list2", "LEFT");

// Blocking rpoplpush
await redis.brpoplpush("source", "dest", 5);
```

### Key Management

```ts
// Find keys matching pattern
const keys = await redis.keys("user:*");

// Scan keys with cursor
const [cursor, foundKeys] = await redis.scan(0, "MATCH", "user:*", "COUNT", 100);

// Get key type
const keyType = await redis.type("mykey");

// Get random key
const randomKey = await redis.randomkey();
```

## Pub/Sub

Bun provides native bindings for the [Redis
Pub/Sub](https://redis.io/docs/latest/develop/pubsub/) protocol. **New in Bun
1.2.23**

{% callout %}
**🚧** — The Redis Pub/Sub feature is experimental. Although we expect it to be
stable, we're currently actively looking for feedback and areas for improvement.
{% /callout %}

### Basic Usage

To get started publishing messages, you can set up a publisher in
`publisher.ts`:

```typescript#publisher.ts
import { RedisClient } from "bun";

const writer = new RedisClient("redis://localhost:6739");
await writer.connect();

writer.publish("general", "Hello everyone!");

writer.close();
```

In another file, create the subscriber in `subscriber.ts`:

```typescript#subscriber.ts
import { RedisClient } from "bun";

const listener = new RedisClient("redis://localhost:6739");
await listener.connect();

await listener.subscribe("general", (message, channel) => {
  console.log(`Received: ${message}`);
});
```

In one shell, run your subscriber:

```bash
bun run subscriber.ts
```

and, in another, run your publisher:

```bash
bun run publisher.ts
```

{% callout %}
**Note:** The subscription mode takes over the `RedisClient` connection. A
client with subscriptions can only call `RedisClient.prototype.subscribe()`. In
other words, applications which need to message Redis need a separate
connection, acquirable through `.duplicate()`:

```typescript
import { RedisClient } from "bun";

const redis = new RedisClient("redis://localhost:6379");
await redis.connect();
const subscriber = await redis.duplicate();

await subscriber.subscribe("foo", () => {});
await redis.set("bar", "baz");
```

{% /callout %}

### Publishing

Publishing messages is done through the `publish()` method:

```typescript
await client.publish(channelName, message);
```

### Subscriptions

The Bun `RedisClient` allows you to subscribe to channels through the
`.subscribe()` method:

```typescript
await client.subscribe(channel, (message, channel) => {});
```

You can unsubscribe through the `.unsubscribe()` method:

```typescript
await client.unsubscribe(); // Unsubscribe from all channels.
await client.unsubscribe(channel); // Unsubscribe a particular channel.
await client.unsubscribe(channel, listener); // Unsubscribe a particular listener.
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

- [ ] Transactions (MULTI/EXEC) must be done through raw commands for now
- [ ] Streams are supported but without dedicated methods
- [ ] Pub/Sub does not currently support binary data, nor pattern-based
      subscriptions.

Unsupported features:

- Redis Sentinel
- Redis Cluster
