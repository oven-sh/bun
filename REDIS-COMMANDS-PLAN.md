# Redis Commands Implementation Plan

## Current Status

**Coverage: 13.2%**
- Total Redis commands: 486
- Implemented: 64
- Missing: 422

## Implemented Commands (64)

The following commands are already implemented:

### String Operations
APPEND, BITCOUNT, DECR, DEL, DUMP, EXISTS, EXPIRE, EXPIRETIME, GET, GETDEL, GETEX, GETSET, INCR, MGET, PERSIST, PEXPIRETIME, PTTL, SET, SETNX, STRLEN, TTL

### Hash Operations
HGET, HGETALL, HINCRBY, HINCRBYFLOAT, HKEYS, HLEN, HMGET, HMSET, HSTRLEN, HVALS

### List Operations
LLEN, LPOP, LPUSH, LPUSHX, RPOP, RPUSH, RPUSHX

### Set Operations
SADD, SCARD, SISMEMBER, SMEMBERS, SMOVE, SPOP, SRANDMEMBER, SREM

### Sorted Set Operations
ZCARD, ZPOPMAX, ZPOPMIN, ZRANDMEMBER, ZRANK, ZREVRANK, ZSCORE

### Pub/Sub
PING, PSUBSCRIBE, PUBLISH, PUNSUBSCRIBE, SPUBLISH, SUBSCRIBE, UNSUBSCRIBE

### Other
KEYS, PFADD, SCRIPT, SELECT, SUBSTR

## Priority 1: Core Commands (106 commands)

These are essential for most Redis use cases and should be implemented first.

### 1. Core String Operations (11 commands)
Essential for basic Redis usage:
- `GETRANGE` - Get substring of string value
- `SETRANGE` - Overwrite part of string
- `SETEX` - Set key with expiration (seconds)
- `PSETEX` - Set key with expiration (milliseconds)
- `GETBIT` - Get bit value at offset
- `SETBIT` - Set bit value at offset
- `INCRBY` - Increment by integer value
- `INCRBYFLOAT` - Increment by float value
- `DECRBY` - Decrement by integer value
- `MSET` - Set multiple keys atomically
- `MSETNX` - Set multiple keys only if none exist

**Implementation note**: Most of these follow simple patterns and can use the `compile.*` helpers.

### 2. List Operations (15 commands)
Core list functionality:
- `LRANGE` - Get range of elements from list (very common!)
- `LINDEX` - Get element by index
- `LSET` - Set element at index
- `LINSERT` - Insert before/after pivot
- `LREM` - Remove elements
- `LTRIM` - Trim list to range
- `RPOPLPUSH` - Pop from one list, push to another
- `LPOS` - Find index of element
- `LMOVE` - Atomically move element between lists
- `BLPOP` - Blocking pop from left (important for queues!)
- `BRPOP` - Blocking pop from right
- `BLMOVE` - Blocking move
- `BRPOPLPUSH` - Blocking RPOPLPUSH
- `LMPOP` - Pop multiple elements
- `BLMPOP` - Blocking LMPOP

**Implementation note**: Blocking operations (`BLPOP`, `BRPOP`) require special async handling.

### 3. Set Operations (9 commands)
Set algebra operations:
- `SINTER` - Intersection of sets
- `SINTERSTORE` - Store intersection
- `SINTERCARD` - Get cardinality of intersection
- `SUNION` - Union of sets
- `SUNIONSTORE` - Store union
- `SDIFF` - Difference of sets
- `SDIFFSTORE` - Store difference
- `SMISMEMBER` - Check multiple members
- `SSCAN` - Iterate set members

### 4. Sorted Set Operations (28 commands)
Most comprehensive missing category:
- `ZADD` - Add members with scores (essential!)
- `ZREM` - Remove members
- `ZINCRBY` - Increment member score
- `ZRANGE` - Get range by index (very common!)
- `ZREVRANGE` - Reverse range by index
- `ZRANGEBYSCORE` - Range by score
- `ZREVRANGEBYSCORE` - Reverse range by score
- `ZRANGEBYLEX` - Range by lexicographic order
- `ZREVRANGEBYLEX` - Reverse lexicographic range
- `ZCOUNT` - Count members in score range
- `ZLEXCOUNT` - Count in lexicographic range
- `ZREMRANGEBYRANK` - Remove by rank range
- `ZREMRANGEBYSCORE` - Remove by score range
- `ZREMRANGEBYLEX` - Remove by lexicographic range
- `ZRANGESTORE` - Store range result
- `ZINTER` - Intersection of sorted sets
- `ZINTERSTORE` - Store intersection
- `ZINTERCARD` - Intersection cardinality
- `ZDIFF` - Difference of sorted sets
- `ZDIFFSTORE` - Store difference
- `ZUNION` - Union of sorted sets
- `ZUNIONSTORE` - Store union
- `ZMSCORE` - Get scores of multiple members
- `ZSCAN` - Iterate sorted set
- `BZPOPMIN` - Blocking pop min
- `BZPOPMAX` - Blocking pop max
- `ZMPOP` - Pop multiple elements
- `BZMPOP` - Blocking ZMPOP

### 5. Hash Operations (18 commands)
Additional hash functionality:
- `HSET` - Set field value (essential!)
- `HSETNX` - Set field only if not exists
- `HDEL` - Delete fields
- `HEXISTS` - Check field exists
- `HRANDFIELD` - Get random field
- `HSCAN` - Iterate hash fields
- Plus newer hash expiration commands: `HGETDEL`, `HGETEX`, `HSETEX`, `HEXPIRE`, `HEXPIREAT`, `HEXPIRETIME`, `HPERSIST`, `HPEXPIRE`, `HPEXPIREAT`, `HPEXPIRETIME`, `HPTTL`, `HTTL`

### 6. Key Expiration & TTL (3 commands)
- `EXPIREAT` - Set expiration timestamp (seconds)
- `PEXPIRE` - Set expiration (milliseconds)
- `PEXPIREAT` - Set expiration timestamp (milliseconds)

### 7. Key Management (8 commands)
- `RENAME` - Rename key
- `RENAMENX` - Rename only if new key doesn't exist
- `COPY` - Copy key to new key
- `UNLINK` - Async delete (better than DEL for large keys)
- `TYPE` - Get type of key
- `TOUCH` - Update last access time
- `RANDOMKEY` - Get random key
- `SCAN` - Iterate keyspace (important for production!)

### 8. Transactions (5 commands)
Critical for atomicity:
- `MULTI` - Start transaction
- `EXEC` - Execute transaction
- `DISCARD` - Discard transaction
- `WATCH` - Watch keys for changes
- `UNWATCH` - Unwatch keys

**Implementation note**: Requires transaction state management in the client.

### 9. Scripting (9 commands)
Lua script support:
- `EVAL` - Execute Lua script
- `EVALSHA` - Execute by SHA1
- `EVAL_RO` - Read-only eval
- `EVALSHA_RO` - Read-only evalsha
- `SCRIPT LOAD` - Load script, return SHA1
- `SCRIPT EXISTS` - Check if scripts exist
- `SCRIPT FLUSH` - Remove all scripts
- `SCRIPT KILL` - Kill running script
- `SCRIPT DEBUG` - Set debug mode

## Priority 2: Extended Features (73 commands)

### HyperLogLog (2)
- `PFCOUNT`, `PFMERGE`

### Bit Operations (4)
- `BITOP`, `BITPOS`, `BITFIELD`, `BITFIELD_RO`

### Geo Commands (10)
Full geospatial support for location-based features

### Streams (21)
Redis Streams for message broker functionality - becoming increasingly popular

### Server Management (15)
`INFO`, `DBSIZE`, `TIME`, `ECHO`, `CONFIG GET/SET`, `FLUSHDB`, `FLUSHALL`, etc.

### Client Management (11)
Connection management commands

### Pub/Sub Advanced (7)
Extended pub/sub introspection

### Sorting & Searching (3)
`SORT`, `SORT_RO`, `LCS`

## Priority 3: Optional/Advanced (104+ commands)

These can be implemented later or as needed:
- Functions (Redis 7.0+)
- Cluster management
- ACL (Access Control Lists)
- Replication commands
- Memory diagnostics
- Module extensions (RedisJSON, RediSearch, Bloom filters, etc.)

## Implementation Strategy

### Phase 1: Quick Wins (Estimated: 1-2 days)
Implement simple commands using the `compile.*` helpers:

```typescript
// In valkey.classes.ts, add to proto:
getrange: { fn: "getrange" },
setrange: { fn: "setrange" },
incrby: { fn: "incrby" },
// ... etc
```

```zig
// In js_valkey_functions.zig:
pub const getrange = compile.@"(key: RedisKey, start: number, end: number)"("getrange", "GETRANGE", .not_subscriber).call;
pub const setrange = compile.@"(key: RedisKey, offset: number, value: RedisValue)"("setrange", "SETRANGE", .not_subscriber).call;
pub const incrby = compile.@"(key: RedisKey, increment: number)"("incrby", "INCRBY", .not_subscriber).call;
```

**Target**: Core String Operations (11), Key Expiration (3), Key Management (8) = 22 commands

### Phase 2: List Operations (Estimated: 2-3 days)
Implement all list commands including blocking operations.

**Target**: 15 list commands

### Phase 3: Set & Hash Operations (Estimated: 2-3 days)
Complete set operations and hash commands.

**Target**: 9 set + 18 hash = 27 commands

### Phase 4: Sorted Sets (Estimated: 3-4 days)
This is the largest category and needs careful implementation.

**Target**: 28 sorted set commands

### Phase 5: Transactions & Scripting (Estimated: 3-4 days)
Requires special state management.

**Target**: 5 transaction + 9 scripting = 14 commands

### After Phase 5
You'll have implemented **106 high-priority commands**, bringing total coverage to:
- **170 commands implemented (35% coverage)**

## Testing Strategy

For each command implemented:
1. Create test in `test/js/bun/redis/`
2. Test basic functionality
3. Test edge cases (nil values, wrong types, etc.)
4. Test error handling
5. Use snapshot testing where appropriate

Example test structure:
```typescript
import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("LRANGE returns list elements", async () => {
  const redis = new RedisClient();
  await redis.connect();

  await redis.lpush("mylist", "world");
  await redis.lpush("mylist", "hello");

  const result = await redis.lrange("mylist", 0, -1);
  expect(result).toEqual(["hello", "world"]);

  redis.close();
});
```

## Notes

- Many commands can share implementation patterns via the `compile.*` helpers
- Blocking commands (`BLPOP`, `BRPOP`, etc.) need special async handling
- Transaction support requires maintaining transaction state
- Some module commands (JSON, Search, etc.) may not be needed immediately
- Focus on commonly-used commands first for maximum impact

## References

- Redis Commands: https://redis.io/commands
- Current implementation: `src/bun.js/api/valkey.classes.ts`
- Command functions: `src/valkey/js_valkey_functions.zig`