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
    tls?:
      | boolean
      | {
          key?: string | Buffer;
          cert?: string | Buffer;
          ca?: string | Buffer | Array<string | Buffer>;
          rejectUnauthorized?: boolean;
        };

    /**
     * Whether to enable auto-pipelining
     * @default true
     */
    enableAutoPipelining?: boolean;
  }

  export namespace RedisClient {
    type KeyLike = string | ArrayBufferView | Blob;
  }

  export class RedisClient {
    /**
     * Creates a new Redis client
     * @param url URL to connect to, defaults to process.env.VALKEY_URL, process.env.REDIS_URL, or "valkey://localhost:6379"
     * @param options Additional options
     *
     * @example
     * ```ts
     * const valkey = new RedisClient();
     *
     * await valkey.set("hello", "world");
     *
     * console.log(await valkey.get("hello"));
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
     * @param error The error that caused the disconnection
     */
    onclose: ((this: RedisClient, error: Error) => void) | null;

    /**
     * Connect to the Redis server
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
     * Set key to hold the string value with expiration at a specific Unix timestamp
     * @param key The key to set
     * @param value The value to set
     * @param exat Set the specified Unix time at which the key will expire, in seconds
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
     * @returns Promise that resolves with "OK" on success, or null if the key already exists
     */
    set(key: RedisClient.KeyLike, value: RedisClient.KeyLike, nx: "NX"): Promise<"OK" | null>;

    /**
     * Set key to hold the string value only if key already exists
     * @param key The key to set
     * @param value The value to set
     * @param xx Only set the key if it already exists
     * @returns Promise that resolves with "OK" on success, or null if the key does not exist
     */
    set(key: RedisClient.KeyLike, value: RedisClient.KeyLike, xx: "XX"): Promise<"OK" | null>;

    /**
     * Set key to hold the string value and return the old value
     * @param key The key to set
     * @param value The value to set
     * @param get Return the old string stored at key, or null if key did not exist
     * @returns Promise that resolves with the old value, or null if key did not exist
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
     * Decrement the integer value of a key by one
     * @param key The key to decrement
     * @returns Promise that resolves with the new value
     */
    decr(key: RedisClient.KeyLike): Promise<number>;

    /**
     * Determine if a key exists
     * @param key The key to check
     * @returns Promise that resolves with true if the key exists, false otherwise
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
     * Get the time to live for a key in seconds
     * @param key The key to get the TTL for
     * @returns Promise that resolves with the TTL, -1 if no expiry, or -2 if key doesn't exist
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
     * @returns Promise that resolves with true if the member exists, false otherwise
     */
    sismember(key: RedisClient.KeyLike, member: string): Promise<boolean>;

    /**
     * Add a member to a set
     * @param key The set key
     * @param member The member to add
     * @returns Promise that resolves with 1 if the member was added, 0 if it already existed
     */
    sadd(key: RedisClient.KeyLike, member: string): Promise<number>;

    /**
     * Remove a member from a set
     * @param key The set key
     * @param member The member to remove
     * @returns Promise that resolves with 1 if the member was removed, 0 if it didn't exist
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
     * @returns Promise that resolves with a random member, or null if the set is empty
     */
    srandmember(key: RedisClient.KeyLike): Promise<string | null>;

    /**
     * Remove and return a random member from a set
     * @param key The set key
     * @returns Promise that resolves with the removed member, or null if the set is empty
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
     * @returns Promise that resolves with the first element, or null if the list is empty
     */
    lpop(key: RedisClient.KeyLike): Promise<string | null>;

    /**
     * Remove the expiration from a key
     * @param key The key to persist
     * @returns Promise that resolves with 1 if the timeout was removed, 0 if the key doesn't exist or has no timeout
     */
    persist(key: RedisClient.KeyLike): Promise<number>;

    /**
     * Get the expiration time of a key as a UNIX timestamp in milliseconds
     * @param key The key to check
     * @returns Promise that resolves with the timestamp, or -1 if the key has no expiration, or -2 if the key doesn't exist
     */
    pexpiretime(key: RedisClient.KeyLike): Promise<number>;

    /**
     * Get the time to live for a key in milliseconds
     * @param key The key to check
     * @returns Promise that resolves with the TTL in milliseconds, or -1 if the key has no expiration, or -2 if the key doesn't exist
     */
    pttl(key: RedisClient.KeyLike): Promise<number>;

    /**
     * Remove and get the last element in a list
     * @param key The list key
     * @returns Promise that resolves with the last element, or null if the list is empty
     */
    rpop(key: RedisClient.KeyLike): Promise<string | null>;

    /**
     * Get the number of members in a set
     * @param key The set key
     * @returns Promise that resolves with the cardinality (number of elements) of the set
     */
    scard(key: RedisClient.KeyLike): Promise<number>;

    /**
     * Get the length of the value stored in a key
     * @param key The key to check
     * @returns Promise that resolves with the length of the string value, or 0 if the key doesn't exist
     */
    strlen(key: RedisClient.KeyLike): Promise<number>;

    /**
     * Get the number of members in a sorted set
     * @param key The sorted set key
     * @returns Promise that resolves with the cardinality (number of elements) of the sorted set
     */
    zcard(key: RedisClient.KeyLike): Promise<number>;

    /**
     * Remove and return members with the highest scores in a sorted set
     * @param key The sorted set key
     * @returns Promise that resolves with the removed member and its score, or null if the set is empty
     */
    zpopmax(key: RedisClient.KeyLike): Promise<string | null>;

    /**
     * Remove and return members with the lowest scores in a sorted set
     * @param key The sorted set key
     * @returns Promise that resolves with the removed member and its score, or null if the set is empty
     */
    zpopmin(key: RedisClient.KeyLike): Promise<string | null>;

    /**
     * Get one or multiple random members from a sorted set
     * @param key The sorted set key
     * @returns Promise that resolves with a random member, or null if the set is empty
     */
    zrandmember(key: RedisClient.KeyLike): Promise<string | null>;

    /**
     * Append a value to a key
     * @param key The key to append to
     * @param value The value to append
     * @returns Promise that resolves with the length of the string after the append operation
     */
    append(key: RedisClient.KeyLike, value: RedisClient.KeyLike): Promise<number>;

    /**
     * Set the value of a key and return its old value
     * @param key The key to set
     * @param value The value to set
     * @returns Promise that resolves with the old value, or null if the key didn't exist
     */
    getset(key: RedisClient.KeyLike, value: RedisClient.KeyLike): Promise<string | null>;

    /**
     * Prepend one or multiple values to a list
     * @param key The list key
     * @param value The value to prepend
     * @returns Promise that resolves with the length of the list after the push operation
     */
    lpush(key: RedisClient.KeyLike, value: RedisClient.KeyLike): Promise<number>;

    /**
     * Prepend a value to a list, only if the list exists
     * @param key The list key
     * @param value The value to prepend
     * @returns Promise that resolves with the length of the list after the push operation, or 0 if the list doesn't exist
     */
    lpushx(key: RedisClient.KeyLike, value: RedisClient.KeyLike): Promise<number>;

    /**
     * Add one or more members to a HyperLogLog
     * @param key The HyperLogLog key
     * @param element The element to add
     * @returns Promise that resolves with 1 if the HyperLogLog was altered, 0 otherwise
     */
    pfadd(key: RedisClient.KeyLike, element: string): Promise<number>;

    /**
     * Append one or multiple values to a list
     * @param key The list key
     * @param value The value to append
     * @returns Promise that resolves with the length of the list after the push operation
     */
    rpush(key: RedisClient.KeyLike, value: RedisClient.KeyLike): Promise<number>;

    /**
     * Append a value to a list, only if the list exists
     * @param key The list key
     * @param value The value to append
     * @returns Promise that resolves with the length of the list after the push operation, or 0 if the list doesn't exist
     */
    rpushx(key: RedisClient.KeyLike, value: RedisClient.KeyLike): Promise<number>;

    /**
     * Set the value of a key, only if the key does not exist
     * @param key The key to set
     * @param value The value to set
     * @returns Promise that resolves with 1 if the key was set, 0 if the key was not set
     */
    setnx(key: RedisClient.KeyLike, value: RedisClient.KeyLike): Promise<number>;

    /**
     * Get the score associated with the given member in a sorted set
     * @param key The sorted set key
     * @param member The member to get the score for
     * @returns Promise that resolves with the score of the member as a string, or null if the member or key doesn't exist
     */
    zscore(key: RedisClient.KeyLike, member: string): Promise<string | null>;

    /**
     * Get the values of all specified keys
     * @param keys The keys to get
     * @returns Promise that resolves with an array of values, with null for keys that don't exist
     */
    mget(...keys: RedisClient.KeyLike[]): Promise<(string | null)[]>;

    /**
     * Count the number of set bits (population counting) in a string
     * @param key The key to count bits in
     * @returns Promise that resolves with the number of bits set to 1
     */
    bitcount(key: RedisClient.KeyLike): Promise<number>;

    /**
     * Return a serialized version of the value stored at the specified key
     * @param key The key to dump
     * @returns Promise that resolves with the serialized value, or null if the key doesn't exist
     */
    dump(key: RedisClient.KeyLike): Promise<string | null>;

    /**
     * Get the expiration time of a key as a UNIX timestamp in seconds
     * @param key The key to check
     * @returns Promise that resolves with the timestamp, or -1 if the key has no expiration, or -2 if the key doesn't exist
     */
    expiretime(key: RedisClient.KeyLike): Promise<number>;

    /**
     * Get the value of a key and delete the key
     * @param key The key to get and delete
     * @returns Promise that resolves with the value of the key, or null if the key doesn't exist
     */
    getdel(key: RedisClient.KeyLike): Promise<string | null>;

    /**
     * Get the value of a key and optionally set its expiration
     * @param key The key to get
     * @returns Promise that resolves with the value of the key, or null if the key doesn't exist
     */
    getex(key: RedisClient.KeyLike): Promise<string | null>;

    /**
     *  Ping the server
     *  @returns Promise that resolves with "PONG" if the server is reachable, or throws an error if the server is not reachable
     */
    ping(): Promise<"PONG">;

    /**
     *  Ping the server with a message
     *  @param message The message to send to the server
     *  @returns Promise that resolves with the message if the server is reachable, or throws an error if the server is not reachable
     */
    ping(message: RedisClient.KeyLike): Promise<string>;
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
