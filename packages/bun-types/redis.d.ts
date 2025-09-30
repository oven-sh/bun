declare module "bun" {
  export interface RedisOptions {
    /**
     * Connection timeout in milliseconds
     * @default 10000
     */
    connectionTimeout?: number;

    /**
     * Idle timeout in milliseconds
     * @default 0 (no timeout)
     */
    idleTimeout?: number;

    /**
     * Whether to automatically reconnect
     * @default true
     */
    autoReconnect?: boolean;

    /**
     * Maximum number of reconnection attempts
     * @default 10
     */
    maxRetries?: number;

    /**
     * Whether to queue commands when disconnected
     * @default true
     */
    enableOfflineQueue?: boolean;

    /**
     * TLS options
     * Can be a boolean or an object with TLS options
     */
    tls?: boolean | Bun.TLSOptions;

    /**
     * Whether to enable auto-pipelining
     * @default true
     */
    enableAutoPipelining?: boolean;
  }

  export namespace RedisClient {
    type KeyLike = string | ArrayBufferView | Blob;
    type StringPubSubListener = (message: string, channel: string) => void;

    // Buffer subscriptions are not yet implemented
    // type BufferPubSubListener = (message: Uint8Array<ArrayBuffer>, channel: string) => void;
  }

  export class RedisClient {
    /**
     * Creates a new Redis client
     *
     * @param url URL to connect to, defaults to `process.env.VALKEY_URL`,
     * `process.env.REDIS_URL`, or `"valkey://localhost:6379"`
     * @param options Additional options
     *
     * @example
     * ```ts
     * const redis = new RedisClient();
     * await redis.set("hello", "world");
     * console.log(await redis.get("hello"));
     * ```
     */
    constructor(url?: string, options?: RedisOptions);

    /**
     * Whether the client is connected to the Redis server
     */
    readonly connected: boolean;

    /**
     * Amount of data buffered in bytes
     */
    readonly bufferedAmount: number;

    /**
     * Callback fired when the client connects to the Redis server
     */
    onconnect: ((this: RedisClient) => void) | null;

    /**
     * Callback fired when the client disconnects from the Redis server
     *
     * @param error The error that caused the disconnection
     */
    onclose: ((this: RedisClient, error: Error) => void) | null;

    /**
     * Connect to the Redis server
     *
     * @returns A promise that resolves when connected
     */
    connect(): Promise<void>;

    /**
     * Disconnect from the Redis server
     */
    close(): void;

    /**
     * Send a raw command to the Redis server
     * @param command The command to send
     * @param args The arguments to the command
     * @returns A promise that resolves with the command result
     */
    send(command: string, args: string[]): Promise<any>;

    /**
     * Get the value of a key
     * @param key The key to get
     * @returns Promise that resolves with the key's value as a string, or null if the key doesn't exist
     */
    get(key: RedisClient.KeyLike): Promise<string | null>;

    /**
     * Get the value of a key as a Uint8Array
     * @param key The key to get
     * @returns Promise that resolves with the key's value as a Uint8Array, or null if the key doesn't exist
     */
    getBuffer(key: RedisClient.KeyLike): Promise<Uint8Array<ArrayBuffer> | null>;

    /**
     * Set key to hold the string value
     * @param key The key to set
     * @param value The value to set
     * @returns Promise that resolves with "OK" on success
     */
    set(key: RedisClient.KeyLike, value: RedisClient.KeyLike): Promise<"OK">;

    /**
     * Set key to hold the string value with expiration
     * @param key The key to set
     * @param value The value to set
     * @param ex Set the specified expire time, in seconds
     * @returns Promise that resolves with "OK" on success
     */
    set(key: RedisClient.KeyLike, value: RedisClient.KeyLike, ex: "EX", seconds: number): Promise<"OK">;

    /**
     * Set key to hold the string value with expiration
     * @param key The key to set
     * @param value The value to set
     * @param px Set the specified expire time, in milliseconds
     * @returns Promise that resolves with "OK" on success
     */
    set(key: RedisClient.KeyLike, value: RedisClient.KeyLike, px: "PX", milliseconds: number): Promise<"OK">;

    /**
     * Set key to hold the string value with expiration at a specific Unix
     * timestamp
     * @param key The key to set
     * @param value The value to set
     * @param exat Set the specified Unix time at which the key will expire, in
     * seconds
     * @returns Promise that resolves with "OK" on success
     */
    set(key: RedisClient.KeyLike, value: RedisClient.KeyLike, exat: "EXAT", timestampSeconds: number): Promise<"OK">;

    /**
     * Set key to hold the string value with expiration at a specific Unix timestamp
     * @param key The key to set
     * @param value The value to set
     * @param pxat Set the specified Unix time at which the key will expire, in milliseconds
     * @returns Promise that resolves with "OK" on success
     */
    set(
      key: RedisClient.KeyLike,
      value: RedisClient.KeyLike,
      pxat: "PXAT",
      timestampMilliseconds: number,
    ): Promise<"OK">;

    /**
     * Set key to hold the string value only if key does not exist
     * @param key The key to set
     * @param value The value to set
     * @param nx Only set the key if it does not already exist
     * @returns Promise that resolves with "OK" on success, or null if the key
     * already exists
     */
    set(key: RedisClient.KeyLike, value: RedisClient.KeyLike, nx: "NX"): Promise<"OK" | null>;

    /**
     * Set key to hold the string value only if key already exists
     * @param key The key to set
     * @param value The value to set
     * @param xx Only set the key if it already exists
     * @returns Promise that resolves with "OK" on success, or null if the key
     * does not exist
     */
    set(key: RedisClient.KeyLike, value: RedisClient.KeyLike, xx: "XX"): Promise<"OK" | null>;

    /**
     * Set key to hold the string value and return the old value
     * @param key The key to set
     * @param value The value to set
     * @param get Return the old string stored at key, or null if key did not
     * exist
     * @returns Promise that resolves with the old value, or null if key did not
     * exist
     */
    set(key: RedisClient.KeyLike, value: RedisClient.KeyLike, get: "GET"): Promise<string | null>;

    /**
     * Set key to hold the string value and retain the time to live
     * @param key The key to set
     * @param value The value to set
     * @param keepttl Retain the time to live associated with the key
     * @returns Promise that resolves with "OK" on success
     */
    set(key: RedisClient.KeyLike, value: RedisClient.KeyLike, keepttl: "KEEPTTL"): Promise<"OK">;

    /**
     * Set key to hold the string value with various options
     * @param key The key to set
     * @param value The value to set
     * @param options Array of options (EX, PX, EXAT, PXAT, NX, XX, KEEPTTL, GET)
     * @returns Promise that resolves with "OK" on success, null if NX/XX condition not met, or the old value if GET is specified
     */
    set(key: RedisClient.KeyLike, value: RedisClient.KeyLike, ...options: string[]): Promise<"OK" | string | null>;

    /**
     * Delete a key(s)
     * @param keys The keys to delete
     * @returns Promise that resolves with the number of keys removed
     */
    del(...keys: RedisClient.KeyLike[]): Promise<number>;

    /**
     * Increment the integer value of a key by one
     * @param key The key to increment
     * @returns Promise that resolves with the new value
     */
    incr(key: RedisClient.KeyLike): Promise<number>;

    /**
     * Increment the integer value of a key by the given amount
     * @param key The key to increment
     * @param increment The amount to increment by
     * @returns Promise that resolves with the new value after incrementing
     */
    incrby(key: RedisClient.KeyLike, increment: number): Promise<number>;

    /**
     * Increment the float value of a key by the given amount
     * @param key The key to increment
     * @param increment The amount to increment by (can be a float)
     * @returns Promise that resolves with the new value as a string after incrementing
     */
    incrbyfloat(key: RedisClient.KeyLike, increment: number | string): Promise<string>;

    /**
     * Decrement the integer value of a key by one
     * @param key The key to decrement
     * @returns Promise that resolves with the new value
     */
    decr(key: RedisClient.KeyLike): Promise<number>;

    /**
     * Decrement the integer value of a key by the given amount
     * @param key The key to decrement
     * @param decrement The amount to decrement by
     * @returns Promise that resolves with the new value after decrementing
     */
    decrby(key: RedisClient.KeyLike, decrement: number): Promise<number>;

    /**
     * Determine if a key exists
     * @param key The key to check
     * @returns Promise that resolves with true if the key exists, false
     * otherwise
     */
    exists(key: RedisClient.KeyLike): Promise<boolean>;

    /**
     * Set a key's time to live in seconds
     * @param key The key to set the expiration for
     * @param seconds The number of seconds until expiration
     * @returns Promise that resolves with 1 if the timeout was set, 0 if not
     */
    expire(key: RedisClient.KeyLike, seconds: number): Promise<number>;

    /**
     * Set the expiration for a key as a Unix timestamp (in seconds)
     * @param key The key to set expiration on
     * @param timestamp Unix timestamp in seconds when the key should expire
     * @returns Promise that resolves with 1 if timeout was set, 0 if key does not exist
     */
    expireat(key: RedisClient.KeyLike, timestamp: number): Promise<number>;

    /**
     * Set a key's time to live in milliseconds
     * @param key The key to set the expiration for
     * @param milliseconds The number of milliseconds until expiration
     * @returns Promise that resolves with 1 if the timeout was set, 0 if the key does not exist
     */
    pexpire(key: RedisClient.KeyLike, milliseconds: number): Promise<number>;

    /**
     * Get the time to live for a key in seconds
     * @param key The key to get the TTL for
     * @returns Promise that resolves with the TTL, -1 if no expiry, or -2 if
     * key doesn't exist
     */
    ttl(key: RedisClient.KeyLike): Promise<number>;

    /**
     * Set multiple hash fields to multiple values
     * @param key The hash key
     * @param fieldValues An array of alternating field names and values
     * @returns Promise that resolves with "OK" on success
     */
    hmset(key: RedisClient.KeyLike, fieldValues: string[]): Promise<string>;

    /**
     * Get the value of a hash field
     * @param key The hash key
     * @param field The field to get
     * @returns Promise that resolves with the field value or null if the field doesn't exist
     */
    hget(key: RedisClient.KeyLike, field: RedisClient.KeyLike): Promise<string | null>;

    /**
     * Get the values of all the given hash fields
     * @param key The hash key
     * @param fields The fields to get
     * @returns Promise that resolves with an array of values
     */
    hmget(key: RedisClient.KeyLike, fields: string[]): Promise<Array<string | null>>;

    /**
     * Check if a value is a member of a set
     * @param key The set key
     * @param member The member to check
     * @returns Promise that resolves with true if the member exists, false
     * otherwise
     */
    sismember(key: RedisClient.KeyLike, member: string): Promise<boolean>;

    /**
     * Add a member to a set
     * @param key The set key
     * @param member The member to add
     * @returns Promise that resolves with 1 if the member was added, 0 if it
     * already existed
     */
    sadd(key: RedisClient.KeyLike, member: string): Promise<number>;

    /**
     * Remove a member from a set
     * @param key The set key
     * @param member The member to remove
     * @returns Promise that resolves with 1 if the member was removed, 0 if it
     * didn't exist
     */
    srem(key: RedisClient.KeyLike, member: string): Promise<number>;

    /**
     * Get all the members in a set
     * @param key The set key
     * @returns Promise that resolves with an array of all members
     */
    smembers(key: RedisClient.KeyLike): Promise<string[]>;

    /**
     * Get a random member from a set
     * @param key The set key
     * @returns Promise that resolves with a random member, or null if the set
     * is empty
     */
    srandmember(key: RedisClient.KeyLike): Promise<string | null>;

    /**
     * Remove and return a random member from a set
     * @param key The set key
     * @returns Promise that resolves with the removed member, or null if the
     * set is empty
     */
    spop(key: RedisClient.KeyLike): Promise<string | null>;

    /**
     * Increment the integer value of a hash field by the given number
     * @param key The hash key
     * @param field The field to increment
     * @param increment The amount to increment by
     * @returns Promise that resolves with the new value
     */
    hincrby(key: RedisClient.KeyLike, field: string, increment: string | number): Promise<number>;

    /**
     * Increment the float value of a hash field by the given amount
     * @param key The hash key
     * @param field The field to increment
     * @param increment The amount to increment by
     * @returns Promise that resolves with the new value as a string
     */
    hincrbyfloat(key: RedisClient.KeyLike, field: string, increment: string | number): Promise<string>;

    /**
     * Get all the fields and values in a hash
     * @param key The hash key
     * @returns Promise that resolves with an object containing all fields and values
     */
    hgetall(key: RedisClient.KeyLike): Promise<Record<string, string> | null>;

    /**
     * Get all field names in a hash
     * @param key The hash key
     * @returns Promise that resolves with an array of field names
     */
    hkeys(key: RedisClient.KeyLike): Promise<string[]>;

    /**
     * Get the number of fields in a hash
     * @param key The hash key
     * @returns Promise that resolves with the number of fields
     */
    hlen(key: RedisClient.KeyLike): Promise<number>;

    /**
     * Get all values in a hash
     * @param key The hash key
     * @returns Promise that resolves with an array of values
     */
    hvals(key: RedisClient.KeyLike): Promise<string[]>;

    /**
     * Find all keys matching the given pattern
     * @param pattern The pattern to match
     * @returns Promise that resolves with an array of matching keys
     */
    keys(pattern: string): Promise<string[]>;

    /**
     * Get the length of a list
     * @param key The list key
     * @returns Promise that resolves with the length of the list
     */
    llen(key: RedisClient.KeyLike): Promise<number>;

    /**
     * Remove and get the first element in a list
     * @param key The list key
     * @returns Promise that resolves with the first element, or null if the
     * list is empty
     */
    lpop(key: RedisClient.KeyLike): Promise<string | null>;

    /**
     * Remove the expiration from a key
     * @param key The key to persist
     * @returns Promise that resolves with 1 if the timeout was removed, 0 if
     * the key doesn't exist or has no timeout
     */
    persist(key: RedisClient.KeyLike): Promise<number>;

    /**
     * Set the expiration for a key as a Unix timestamp in milliseconds
     * @param key The key to set expiration on
     * @param millisecondsTimestamp Unix timestamp in milliseconds when the key should expire
     * @returns Promise that resolves with 1 if timeout was set, 0 if key does not exist
     */
    pexpireat(key: RedisClient.KeyLike, millisecondsTimestamp: number): Promise<number>;

    /**
     * Get the expiration time of a key as a UNIX timestamp in milliseconds
     * @param key The key to check
     * @returns Promise that resolves with the timestamp, or -1 if the key has
     * no expiration, or -2 if the key doesn't exist
     */
    pexpiretime(key: RedisClient.KeyLike): Promise<number>;

    /**
     * Get the time to live for a key in milliseconds
     * @param key The key to check
     * @returns Promise that resolves with the TTL in milliseconds, or -1 if the
     * key has no expiration, or -2 if the key doesn't exist
     */
    pttl(key: RedisClient.KeyLike): Promise<number>;

    /**
     * Return a random key from the keyspace
     *
     * Returns a random key from the currently selected database.
     *
     * @returns Promise that resolves with a random key name, or null if the
     * database is empty
     *
     * @example
     * ```ts
     * await redis.set("key1", "value1");
     * await redis.set("key2", "value2");
     * await redis.set("key3", "value3");
     * const randomKey = await redis.randomkey();
     * console.log(randomKey); // One of: "key1", "key2", or "key3"
     * ```
     */
    randomkey(): Promise<string | null>;

    /**
     * Remove and get the last element in a list
     * @param key The list key
     * @returns Promise that resolves with the last element, or null if the list is empty
     */
    rpop(key: RedisClient.KeyLike): Promise<string | null>;

    /**
     * Incrementally iterate the keyspace
     *
     * The SCAN command is used to incrementally iterate over a collection of
     * elements. SCAN iterates the set of keys in the currently selected Redis
     * database.
     *
     * SCAN is a cursor based iterator. This means that at every call of the
     * command, the server returns an updated cursor that the user needs to use
     * as the cursor argument in the next call.
     *
     * An iteration starts when the cursor is set to "0", and terminates when
     * the cursor returned by the server is "0".
     *
     * @param cursor The cursor value (use "0" to start a new iteration)
     * @returns Promise that resolves with a tuple [cursor, keys[]] where cursor
     * is the next cursor to use (or "0" if iteration is complete) and keys is
     * an array of matching keys
     *
     * @example
     * ```ts
     * // Basic scan - iterate all keys
     * let cursor = "0";
     * const allKeys: string[] = [];
     * do {
     *   const [nextCursor, keys] = await redis.scan(cursor);
     *   allKeys.push(...keys);
     *   cursor = nextCursor;
     * } while (cursor !== "0");
     * ```
     *
     * @example
     * ```ts
     * // Scan with MATCH pattern
     * const [cursor, keys] = await redis.scan("0", "MATCH", "user:*");
     * ```
     *
     * @example
     * ```ts
     * // Scan with COUNT hint
     * const [cursor, keys] = await redis.scan("0", "COUNT", "100");
     * ```
     */
    scan(cursor: string | number): Promise<[string, string[]]>;

    /**
     * Incrementally iterate the keyspace with a pattern match
     *
     * @param cursor The cursor value (use "0" to start a new iteration)
     * @param match The "MATCH" keyword
     * @param pattern The pattern to match (supports glob-style patterns like "user:*")
     * @returns Promise that resolves with a tuple [cursor, keys[]]
     */
    scan(cursor: string | number, match: "MATCH", pattern: string): Promise<[string, string[]]>;

    /**
     * Incrementally iterate the keyspace with a count hint
     *
     * @param cursor The cursor value (use "0" to start a new iteration)
     * @param count The "COUNT" keyword
     * @param hint The number of elements to return per call (hint only, not exact)
     * @returns Promise that resolves with a tuple [cursor, keys[]]
     */
    scan(cursor: string | number, count: "COUNT", hint: number): Promise<[string, string[]]>;

    /**
     * Incrementally iterate the keyspace with pattern match and count hint
     *
     * @param cursor The cursor value (use "0" to start a new iteration)
     * @param match The "MATCH" keyword
     * @param pattern The pattern to match
     * @param count The "COUNT" keyword
     * @param hint The number of elements to return per call
     * @returns Promise that resolves with a tuple [cursor, keys[]]
     */
    scan(
      cursor: string | number,
      match: "MATCH",
      pattern: string,
      count: "COUNT",
      hint: number,
    ): Promise<[string, string[]]>;

    /**
     * Incrementally iterate the keyspace with options
     *
     * @param cursor The cursor value
     * @param options Additional SCAN options (MATCH pattern, COUNT hint, etc.)
     * @returns Promise that resolves with a tuple [cursor, keys[]]
     */
    scan(cursor: string | number, ...options: (string | number)[]): Promise<[string, string[]]>;

    /**
     * Get the number of members in a set
     * @param key The set key
     * @returns Promise that resolves with the cardinality (number of elements)
     * of the set
     */
    scard(key: RedisClient.KeyLike): Promise<number>;

    /**
     * Get the length of the value stored in a key
     * @param key The key to check
     * @returns Promise that resolves with the length of the string value, or 0
     * if the key doesn't exist
     */
    strlen(key: RedisClient.KeyLike): Promise<number>;

    /**
     * Determine the type of value stored at key
     *
     * The TYPE command returns the string representation of the type of the
     * value stored at key. The different types that can be returned are:
     * string, list, set, zset, hash and stream.
     *
     * @param key The key to check
     * @returns Promise that resolves with the type of value stored at key, or
     * "none" if the key doesn't exist
     *
     * @example
     * ```ts
     * await redis.set("mykey", "Hello");
     * console.log(await redis.type("mykey")); // "string"
     *
     * await redis.lpush("mylist", "value");
     * console.log(await redis.type("mylist")); // "list"
     *
     * await redis.sadd("myset", "value");
     * console.log(await redis.type("myset")); // "set"
     *
     * await redis.hset("myhash", "field", "value");
     * console.log(await redis.type("myhash")); // "hash"
     *
     * console.log(await redis.type("nonexistent")); // "none"
     * ```
     */
    type(key: RedisClient.KeyLike): Promise<"none" | "string" | "list" | "set" | "zset" | "hash" | "stream">;

    /**
     * Get the number of members in a sorted set
     * @param key The sorted set key
     * @returns Promise that resolves with the cardinality (number of elements)
     * of the sorted set
     */
    zcard(key: RedisClient.KeyLike): Promise<number>;

    /**
     * Count the members in a sorted set with scores within the given range
     * @param key The sorted set key
     * @param min Minimum score (inclusive, use "-inf" for negative infinity)
     * @param max Maximum score (inclusive, use "+inf" for positive infinity)
     * @returns Promise that resolves with the count of elements in the specified score range
     */
    zcount(key: RedisClient.KeyLike, min: string | number, max: string | number): Promise<number>;

    /**
     * Count the members in a sorted set within a lexicographical range
     * @param key The sorted set key
     * @param min Minimum value (use "[" for inclusive, "(" for exclusive, e.g., "[aaa")
     * @param max Maximum value (use "[" for inclusive, "(" for exclusive, e.g., "[zzz")
     * @returns Promise that resolves with the count of elements in the specified range
     */
    zlexcount(key: RedisClient.KeyLike, min: string, max: string): Promise<number>;

    /**
     * Remove and return members with the highest scores in a sorted set
     * @param key The sorted set key
     * @returns Promise that resolves with the removed member and its score, or
     * null if the set is empty
     */
    zpopmax(key: RedisClient.KeyLike): Promise<string | null>;

    /**
     * Remove and return members with the lowest scores in a sorted set
     * @param key The sorted set key
     * @returns Promise that resolves with the removed member and its score, or
     * null if the set is empty
     */
    zpopmin(key: RedisClient.KeyLike): Promise<string | null>;

    /**
     * Get one or multiple random members from a sorted set
     * @param key The sorted set key
     * @returns Promise that resolves with a random member, or null if the set
     * is empty
     */
    zrandmember(key: RedisClient.KeyLike): Promise<string | null>;

    /**
     * Append a value to a key
     * @param key The key to append to
     * @param value The value to append
     * @returns Promise that resolves with the length of the string after the
     * append operation
     */
    append(key: RedisClient.KeyLike, value: RedisClient.KeyLike): Promise<number>;

    /**
     * Set the value of a key and return its old value
     * @param key The key to set
     * @param value The value to set
     * @returns Promise that resolves with the old value, or null if the key
     * didn't exist
     */
    getset(key: RedisClient.KeyLike, value: RedisClient.KeyLike): Promise<string | null>;

    /**
     * Prepend one or multiple values to a list
     * @param key The list key
     * @param value The value to prepend
     * @returns Promise that resolves with the length of the list after the push
     * operation
     */
    lpush(key: RedisClient.KeyLike, value: RedisClient.KeyLike): Promise<number>;

    /**
     * Prepend a value to a list, only if the list exists
     * @param key The list key
     * @param value The value to prepend
     * @returns Promise that resolves with the length of the list after the push
     * operation, or 0 if the list doesn't exist
     */
    lpushx(key: RedisClient.KeyLike, value: RedisClient.KeyLike): Promise<number>;

    /**
     * Add one or more members to a HyperLogLog
     * @param key The HyperLogLog key
     * @param element The element to add
     * @returns Promise that resolves with 1 if the HyperLogLog was altered, 0
     * otherwise
     */
    pfadd(key: RedisClient.KeyLike, element: string): Promise<number>;

    /**
     * Append one or multiple values to a list
     * @param key The list key
     * @param value The value to append
     * @returns Promise that resolves with the length of the list after the push
     * operation
     */
    rpush(key: RedisClient.KeyLike, value: RedisClient.KeyLike): Promise<number>;

    /**
     * Append a value to a list, only if the list exists
     * @param key The list key
     * @param value The value to append
     * @returns Promise that resolves with the length of the list after the push
     * operation, or 0 if the list doesn't exist
     */
    rpushx(key: RedisClient.KeyLike, value: RedisClient.KeyLike): Promise<number>;

    /**
     * Set the value of a key, only if the key does not exist
     * @param key The key to set
     * @param value The value to set
     * @returns Promise that resolves with 1 if the key was set, 0 if the key
     * was not set
     */
    setnx(key: RedisClient.KeyLike, value: RedisClient.KeyLike): Promise<number>;

    /**
     * Set key to hold the string value with expiration time in seconds
     * @param key The key to set
     * @param seconds The expiration time in seconds
     * @param value The value to set
     * @returns Promise that resolves with "OK" on success
     *
     * @example
     * ```ts
     * await redis.setex("mykey", 10, "Hello");
     * // Key will expire after 10 seconds
     * ```
     */
    setex(key: RedisClient.KeyLike, seconds: number, value: RedisClient.KeyLike): Promise<"OK">;

    /**
     * Set key to hold the string value with expiration time in milliseconds
     * @param key The key to set
     * @param milliseconds The expiration time in milliseconds
     * @param value The value to set
     * @returns Promise that resolves with "OK" on success
     *
     * @example
     * ```ts
     * await redis.psetex("mykey", 10000, "Hello");
     * // Key will expire after 10000 milliseconds (10 seconds)
     * ```
     */
    psetex(key: RedisClient.KeyLike, milliseconds: number, value: RedisClient.KeyLike): Promise<"OK">;

    /**
     * Get the score associated with the given member in a sorted set
     * @param key The sorted set key
     * @param member The member to get the score for
     * @returns Promise that resolves with the score of the member as a string,
     * or null if the member or key doesn't exist
     */
    zscore(key: RedisClient.KeyLike, member: string): Promise<string | null>;

    /**
     * Increment the score of a member in a sorted set
     * @param key The sorted set key
     * @param increment The increment value
     * @param member The member to increment
     * @returns Promise that resolves with the new score
     */
    zincrby(key: RedisClient.KeyLike, increment: number, member: RedisClient.KeyLike): Promise<number>;

    /**
     * Returns the scores associated with the specified members in the sorted set
     * @param key The sorted set key
     * @param member The first member to get the score for
     * @param members Additional members to get scores for
     * @returns Promise that resolves with an array of scores (number for each score, or null if member doesn't exist)
     */
    zmscore(key: RedisClient.KeyLike, member: RedisClient.KeyLike, ...members: RedisClient.KeyLike[]): Promise<(number | null)[]>;

    /**
     * Remove one or more members from a sorted set
     * @param key The sorted set key
     * @param member The first member to remove
     * @param members Additional members to remove
     * @returns Promise that resolves with the number of members removed (not including non-existing members)
     */
    zrem(key: RedisClient.KeyLike, member: RedisClient.KeyLike, ...members: RedisClient.KeyLike[]): Promise<number>;

    /**
     * Remove all members in a sorted set within the given lexicographical range
     * @param key The sorted set key
     * @param min Minimum value (use "[" for inclusive, "(" for exclusive, e.g., "[aaa")
     * @param max Maximum value (use "[" for inclusive, "(" for exclusive, e.g., "[zzz")
     * @returns Promise that resolves with the number of elements removed
     */
    zremrangebylex(key: RedisClient.KeyLike, min: string, max: string): Promise<number>;

    /**
     * Remove all members in a sorted set within the given rank range
     * @param key The sorted set key
     * @param start Start rank (0-based, can be negative to indicate offset from end)
     * @param stop Stop rank (0-based, can be negative to indicate offset from end)
     * @returns Promise that resolves with the number of elements removed
     */
    zremrangebyrank(key: RedisClient.KeyLike, start: number, stop: number): Promise<number>;

    /**
     * Remove all members in a sorted set within the given score range
     * @param key The sorted set key
     * @param min Minimum score (inclusive, use "-inf" for negative infinity, "(" prefix for exclusive)
     * @param max Maximum score (inclusive, use "+inf" for positive infinity, "(" prefix for exclusive)
     * @returns Promise that resolves with the number of elements removed
     */
    zremrangebyscore(key: RedisClient.KeyLike, min: string | number, max: string | number): Promise<number>;

    /**
     * Get the values of all specified keys
     * @param keys The keys to get
     * @returns Promise that resolves with an array of values, with null for
     * keys that don't exist
     */
    mget(...keys: RedisClient.KeyLike[]): Promise<(string | null)[]>;

    /**
     * Set multiple keys to multiple values atomically
     *
     * Sets the given keys to their respective values. MSET replaces existing
     * values with new values, just as regular SET. Use MSETNX if you don't want
     * to overwrite existing values.
     *
     * MSET is atomic, so all given keys are set at once. It is not possible for
     * clients to see that some of the keys were updated while others are
     * unchanged.
     *
     * @param keyValuePairs Alternating keys and values (key1, value1, key2, value2, ...)
     * @returns Promise that resolves with "OK" on success
     *
     * @example
     * ```ts
     * await redis.mset("key1", "value1", "key2", "value2");
     * ```
     */
    mset(...keyValuePairs: RedisClient.KeyLike[]): Promise<"OK">;

    /**
     * Set multiple keys to multiple values, only if none of the keys exist
     *
     * Sets the given keys to their respective values. MSETNX will not perform
     * any operation at all even if just a single key already exists.
     *
     * Because of this semantic, MSETNX can be used in order to set different
     * keys representing different fields of a unique logic object in a way that
     * ensures that either all the fields or none at all are set.
     *
     * MSETNX is atomic, so all given keys are set at once. It is not possible
     * for clients to see that some of the keys were updated while others are
     * unchanged.
     *
     * @param keyValuePairs Alternating keys and values (key1, value1, key2, value2, ...)
     * @returns Promise that resolves with 1 if all keys were set, 0 if no key was set
     *
     * @example
     * ```ts
     * // Returns 1 if keys don't exist
     * await redis.msetnx("key1", "value1", "key2", "value2");
     *
     * // Returns 0 if any key already exists
     * await redis.msetnx("key1", "newvalue", "key3", "value3");
     * ```
     */
    msetnx(...keyValuePairs: RedisClient.KeyLike[]): Promise<number>;

    /**
     * Count the number of set bits (population counting) in a string
     * @param key The key to count bits in
     * @returns Promise that resolves with the number of bits set to 1
     */
    bitcount(key: RedisClient.KeyLike): Promise<number>;

    /**
     * Returns the bit value at offset in the string value stored at key
     * @param key The key containing the string value
     * @param offset The bit offset (zero-based)
     * @returns Promise that resolves with the bit value (0 or 1) at the specified offset
     */
    getbit(key: RedisClient.KeyLike, offset: number): Promise<number>;

    /**
     * Sets or clears the bit at offset in the string value stored at key
     * @param key The key to modify
     * @param offset The bit offset (zero-based)
     * @param value The bit value to set (0 or 1)
     * @returns Promise that resolves with the original bit value stored at offset
     */
    setbit(key: RedisClient.KeyLike, offset: number, value: 0 | 1): Promise<number>;

    /**
     * Get a substring of the string stored at a key
     * @param key The key to get the substring from
     * @param start The starting offset (can be negative to count from the end)
     * @param end The ending offset (can be negative to count from the end)
     * @returns Promise that resolves with the substring, or an empty string if the key doesn't exist
     */
    getrange(key: RedisClient.KeyLike, start: number, end: number): Promise<string>;

    /**
     * Overwrite part of a string at key starting at the specified offset
     * @param key The key to modify
     * @param offset The offset at which to start overwriting (zero-based)
     * @param value The string value to write at the offset
     * @returns Promise that resolves with the length of the string after modification
     */
    setrange(key: RedisClient.KeyLike, offset: number, value: RedisClient.KeyLike): Promise<number>;

    /**
     * Return a serialized version of the value stored at the specified key
     * @param key The key to dump
     * @returns Promise that resolves with the serialized value, or null if the
     * key doesn't exist
     */
    dump(key: RedisClient.KeyLike): Promise<string | null>;

    /**
     * Get the expiration time of a key as a UNIX timestamp in seconds
     *
     * @param key The key to check
     * @returns Promise that resolves with the timestamp, or -1 if the key has
     * no expiration, or -2 if the key doesn't exist
     */
    expiretime(key: RedisClient.KeyLike): Promise<number>;

    /**
     * Get the value of a key and delete the key
     *
     * @param key The key to get and delete
     * @returns Promise that resolves with the value of the key, or null if the
     * key doesn't exist
     */
    getdel(key: RedisClient.KeyLike): Promise<string | null>;

    /**
     * Get the value of a key and optionally set its expiration
     *
     * @param key The key to get
     * @returns Promise that resolves with the value of the key, or null if the
     * key doesn't exist
     */
    getex(key: RedisClient.KeyLike): Promise<string | null>;

    /**
     * Get the value of a key and set its expiration in seconds
     *
     * @param key The key to get
     * @param ex Set the specified expire time, in seconds
     * @param seconds The number of seconds until expiration
     * @returns Promise that resolves with the value of the key, or null if the
     * key doesn't exist
     */
    getex(key: RedisClient.KeyLike, ex: "EX", seconds: number): Promise<string | null>;

    /**
     * Get the value of a key and set its expiration in milliseconds
     * @param key The key to get
     * @param px Set the specified expire time, in milliseconds
     * @param milliseconds The number of milliseconds until expiration
     * @returns Promise that resolves with the value of the key, or null if the key doesn't exist
     */
    getex(key: RedisClient.KeyLike, px: "PX", milliseconds: number): Promise<string | null>;

    /**
     * Get the value of a key and set its expiration at a specific Unix timestamp in seconds
     *
     * @param key The key to get
     * @param exat Set the specified Unix time at which the key will expire, in seconds
     * @param timestampSeconds The Unix timestamp in seconds
     * @returns Promise that resolves with the value of the key, or null if the key doesn't exist
     */
    getex(key: RedisClient.KeyLike, exat: "EXAT", timestampSeconds: number): Promise<string | null>;

    /**
     * Get the value of a key and set its expiration at a specific Unix timestamp in milliseconds
     *
     * @param key The key to get
     * @param pxat Set the specified Unix time at which the key will expire, in milliseconds
     * @param timestampMilliseconds The Unix timestamp in milliseconds
     * @returns Promise that resolves with the value of the key, or null if the key doesn't exist
     */
    getex(key: RedisClient.KeyLike, pxat: "PXAT", timestampMilliseconds: number): Promise<string | null>;

    /**
     * Get the value of a key and remove its expiration
     *
     * @param key The key to get
     * @param persist Remove the expiration from the key
     * @returns Promise that resolves with the value of the key, or null if the key doesn't exist
     */
    getex(key: RedisClient.KeyLike, persist: "PERSIST"): Promise<string | null>;

    /**
     *  Ping the server
     *  @returns Promise that resolves with "PONG" if the server is reachable, or throws an error if the server is not reachable
     */
    ping(): Promise<"PONG">;

    /**
     *  Ping the server with a message
     *
     *  @param message The message to send to the server
     *  @returns Promise that resolves with the message if the server is reachable, or throws an error if the server is not reachable
     */
    ping(message: RedisClient.KeyLike): Promise<string>;

    /**
     * Publish a message to a Redis channel.
     *
     * @param channel The channel to publish to.
     * @param message The message to publish.
     *
     * @returns The number of clients that received the message. Note that in a
     * cluster this returns the total number of clients in the same node.
     */
    publish(channel: string, message: string): Promise<number>;

    /**
     * Subscribe to a Redis channel.
     *
     * Subscribing disables automatic pipelining, so all commands will be
     * received immediately.
     *
     * Subscribing moves the channel to a dedicated subscription state which
     * prevents most other commands from being executed until unsubscribed. Only
     * {@link ping `.ping()`}, {@link subscribe `.subscribe()`}, and
     * {@link unsubscribe `.unsubscribe()`} are legal to invoke in a subscribed
     * upon channel.
     *
     * @param channel The channel to subscribe to.
     * @param listener The listener to call when a message is received on the
     * channel. The listener will receive the message as the first argument and
     * the channel as the second argument.
     *
     * @example
     * ```ts
     * await client.subscribe("my-channel", (message, channel) => {
     *   console.log(`Received message on ${channel}: ${message}`);
     * });
     * ```
     */
    subscribe(channel: string, listener: RedisClient.StringPubSubListener): Promise<number>;

    /**
     * Subscribe to multiple Redis channels.
     *
     * Subscribing disables automatic pipelining, so all commands will be
     * received immediately.
     *
     * Subscribing moves the channels to a dedicated subscription state in which
     * only a limited set of commands can be executed.
     *
     * @param channels An array of channels to subscribe to.
     * @param listener The listener to call when a message is received on any of
     * the subscribed channels. The listener will receive the message as the
     * first argument and the channel as the second argument.
     */
    subscribe(channels: string[], listener: RedisClient.StringPubSubListener): Promise<number>;

    /**
     * Unsubscribe from a singular Redis channel.
     *
     * @param channel The channel to unsubscribe from.
     *
     * If there are no more channels subscribed to, the client automatically
     * re-enables pipelining if it was previously enabled.
     *
     * Unsubscribing moves the channel back to a normal state out of the
     * subscription state if all channels have been unsubscribed from. For
     * further details on the subscription state, see
     * {@link subscribe `.subscribe()`}.
     */
    unsubscribe(channel: string): Promise<void>;

    /**
     * Remove a listener from a given Redis channel.
     *
     * If there are no more channels subscribed to, the client automatically
     * re-enables pipelining if it was previously enabled.
     *
     * Unsubscribing moves the channel back to a normal state out of the
     * subscription state if all channels have been unsubscribed from. For
     * further details on the subscription state, see
     * {@link subscribe `.subscribe()`}.
     *
     * @param channel The channel to unsubscribe from.
     * @param listener The listener to remove. This is tested against
     * referential equality so you must pass the exact same listener instance as
     * when subscribing.
     */
    unsubscribe(channel: string, listener: RedisClient.StringPubSubListener): Promise<void>;

    /**
     * Unsubscribe from all registered Redis channels.
     *
     * The client will automatically re-enable pipelining if it was previously
     * enabled.
     *
     * Unsubscribing moves the channel back to a normal state out of the
     * subscription state if all channels have been unsubscribed from. For
     * further details on the subscription state, see
     * {@link subscribe `.subscribe()`}.
     */
    unsubscribe(): Promise<void>;

    /**
     * Unsubscribe from multiple Redis channels.
     *
     * @param channels An array of channels to unsubscribe from.
     *
     * If there are no more channels subscribed to, the client automatically
     * re-enables pipelining if it was previously enabled.
     *
     * Unsubscribing moves the channel back to a normal state out of the
     * subscription state if all channels have been unsubscribed from. For
     * further details on the subscription state, see
     * {@link subscribe `.subscribe()`}.
     */
    unsubscribe(channels: string[]): Promise<void>;

    /**
     * @brief Create a new RedisClient instance with the same configuration as
     *        the current instance.
     *
     * This will open up a new connection to the Redis server.
     */
    duplicate(): Promise<RedisClient>;

    /**
     * Copy the value stored at the source key to the destination key
     *
     * By default, the destination key is created in the logical database used
     * by the connection. The REPLACE option removes the destination key before
     * copying the value to it.
     *
     * @param source The source key to copy from
     * @param destination The destination key to copy to
     * @returns Promise that resolves with 1 if the key was copied, 0 if not
     *
     * @example
     * ```ts
     * await redis.set("mykey", "Hello");
     * await redis.copy("mykey", "myotherkey");
     * console.log(await redis.get("myotherkey")); // "Hello"
     * ```
     */
    copy(source: RedisClient.KeyLike, destination: RedisClient.KeyLike): Promise<number>;

    /**
     * Copy the value stored at the source key to the destination key, optionally replacing it
     *
     * The REPLACE option removes the destination key before copying the value to it.
     *
     * @param source The source key to copy from
     * @param destination The destination key to copy to
     * @param replace "REPLACE" - Remove the destination key before copying
     * @returns Promise that resolves with 1 if the key was copied, 0 if not
     *
     * @example
     * ```ts
     * await redis.set("mykey", "Hello");
     * await redis.set("myotherkey", "World");
     * await redis.copy("mykey", "myotherkey", "REPLACE");
     * console.log(await redis.get("myotherkey")); // "Hello"
     * ```
     */
    copy(source: RedisClient.KeyLike, destination: RedisClient.KeyLike, replace: "REPLACE"): Promise<number>;

    /**
     * Asynchronously delete one or more keys
     *
     * This command is very similar to DEL: it removes the specified keys.
     * Just like DEL a key is ignored if it does not exist. However, the
     * command performs the actual memory reclaiming in a different thread, so
     * it is not blocking, while DEL is. This is particularly useful when
     * deleting large values or large numbers of keys.
     *
     * @param keys The keys to delete
     * @returns Promise that resolves with the number of keys that were unlinked
     *
     * @example
     * ```ts
     * await redis.set("key1", "Hello");
     * await redis.set("key2", "World");
     * const count = await redis.unlink("key1", "key2", "key3");
     * console.log(count); // 2
     * ```
     */
    unlink(...keys: RedisClient.KeyLike[]): Promise<number>;

    /**
     * Alters the last access time of one or more keys
     *
     * A key is ignored if it does not exist. The command returns the number
     * of keys that were touched.
     *
     * This command is useful in conjunction with maxmemory-policy
     * allkeys-lru / volatile-lru to change the last access time of keys for
     * eviction purposes.
     *
     * @param keys One or more keys to touch
     * @returns Promise that resolves with the number of keys that were touched
     *
     * @example
     * ```ts
     * await redis.set("key1", "Hello");
     * await redis.set("key2", "World");
     * const touched = await redis.touch("key1", "key2", "key3");
     * console.log(touched); // 2 (key3 doesn't exist)
     * ```
     */
    touch(...keys: RedisClient.KeyLike[]): Promise<number>;

    /**
     * Rename a key to a new key
     *
     * Renames key to newkey. If newkey already exists, it is overwritten. If
     * key does not exist, an error is returned.
     *
     * @param key The key to rename
     * @param newkey The new key name
     * @returns Promise that resolves with "OK" on success
     *
     * @example
     * ```ts
     * await redis.set("mykey", "Hello");
     * await redis.rename("mykey", "myotherkey");
     * const value = await redis.get("myotherkey"); // "Hello"
     * const oldValue = await redis.get("mykey"); // null
     * ```
     */
    rename(key: RedisClient.KeyLike, newkey: RedisClient.KeyLike): Promise<"OK">;

    /**
     * Rename a key to a new key only if the new key does not exist
     *
     * Renames key to newkey only if newkey does not yet exist. If key does not
     * exist, an error is returned.
     *
     * @param key The key to rename
     * @param newkey The new key name
     * @returns Promise that resolves with 1 if the key was renamed, 0 if newkey already exists
     *
     * @example
     * ```ts
     * await redis.set("mykey", "Hello");
     * await redis.renamenx("mykey", "myotherkey"); // Returns 1
     * await redis.set("mykey2", "World");
     * await redis.renamenx("mykey2", "myotherkey"); // Returns 0 (myotherkey exists)
     * ```
     */
    renamenx(key: RedisClient.KeyLike, newkey: RedisClient.KeyLike): Promise<number>;
  }

  /**
   * Default Redis client
   *
   * Connection information populated from one of, in order of preference:
   * - `process.env.VALKEY_URL`
   * - `process.env.REDIS_URL`
   * - `"valkey://localhost:6379"`
   *
   */
  export const redis: RedisClient;
}
