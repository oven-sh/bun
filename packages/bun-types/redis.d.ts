declare module "bun" {
  export interface RedisOptions {
    /**
     * URL to connect to, defaults to "redis://localhost:6379"
     * Supported protocols: redis://, rediss://, redis+unix://, redis+tls://
     */
    url?: string;

    /**
     * Connection timeout in milliseconds
     * @default 10000
     */
    connectionTimeout?: number;

    /**
     * Socket timeout in milliseconds
     * @default 0 (no timeout)
     */
    socketTimeout?: number;

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
    disconnect(): void;

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
     * @returns Promise that resolves with the key's value, or null if the key doesn't exist
     */
    get(key: string | NodeJS.TypedArray | Blob): Promise<string | null>;

    /**
     * Set the value of a key
     * @param key The key to set
     * @param value The value to set
     * @returns Promise that resolves with "OK" on success
     */
    set(key: string | NodeJS.TypedArray | Blob, value: string | NodeJS.TypedArray | Blob): Promise<"OK">;

    /**
     * Delete a key
     * @param key The key to delete
     * @returns Promise that resolves with the number of keys removed
     */
    del(key: string | NodeJS.TypedArray | Blob): Promise<number>;

    /**
     * Increment the integer value of a key by one
     * @param key The key to increment
     * @returns Promise that resolves with the new value
     */
    incr(key: string | NodeJS.TypedArray | Blob): Promise<number>;

    /**
     * Decrement the integer value of a key by one
     * @param key The key to decrement
     * @returns Promise that resolves with the new value
     */
    decr(key: string | NodeJS.TypedArray | Blob): Promise<number>;

    /**
     * Determine if a key exists
     * @param key The key to check
     * @returns Promise that resolves with true if the key exists, false otherwise
     */
    exists(key: string | NodeJS.TypedArray | Blob): Promise<boolean>;

    /**
     * Set a key's time to live in seconds
     * @param key The key to set the expiration for
     * @param seconds The number of seconds until expiration
     * @returns Promise that resolves with 1 if the timeout was set, 0 if not
     */
    expire(key: string | NodeJS.TypedArray | Blob, seconds: number): Promise<number>;

    /**
     * Get the time to live for a key in seconds
     * @param key The key to get the TTL for
     * @returns Promise that resolves with the TTL, -1 if no expiry, or -2 if key doesn't exist
     */
    ttl(key: string | NodeJS.TypedArray | Blob): Promise<number>;

    /**
     * Set multiple hash fields to multiple values
     * @param key The hash key
     * @param fieldValues An array of alternating field names and values
     * @returns Promise that resolves with "OK" on success
     */
    hmset(key: string | NodeJS.TypedArray | Blob, fieldValues: string[]): Promise<"OK">;

    /**
     * Get the values of all the given hash fields
     * @param key The hash key
     * @param fields The fields to get
     * @returns Promise that resolves with an array of values
     */
    hmget(key: string | NodeJS.TypedArray | Blob, fields: string[]): Promise<Array<string | null>>;

    /**
     * Check if a value is a member of a set
     * @param key The set key
     * @param member The member to check
     * @returns Promise that resolves with true if the member exists, false otherwise
     */
    sismember(key: string | NodeJS.TypedArray | Blob, member: string): Promise<boolean>;

    /**
     * Add a member to a set
     * @param key The set key
     * @param member The member to add
     * @returns Promise that resolves with 1 if the member was added, 0 if it already existed
     */
    sadd(key: string | NodeJS.TypedArray | Blob, member: string): Promise<number>;

    /**
     * Remove a member from a set
     * @param key The set key
     * @param member The member to remove
     * @returns Promise that resolves with 1 if the member was removed, 0 if it didn't exist
     */
    srem(key: string | NodeJS.TypedArray | Blob, member: string): Promise<number>;

    /**
     * Get all the members in a set
     * @param key The set key
     * @returns Promise that resolves with an array of all members
     */
    smembers(key: string | NodeJS.TypedArray | Blob): Promise<string[]>;

    /**
     * Get a random member from a set
     * @param key The set key
     * @returns Promise that resolves with a random member, or null if the set is empty
     */
    srandmember(key: string | NodeJS.TypedArray | Blob): Promise<string | null>;

    /**
     * Remove and return a random member from a set
     * @param key The set key
     * @returns Promise that resolves with the removed member, or null if the set is empty
     */
    spop(key: string | NodeJS.TypedArray | Blob): Promise<string | null>;

    /**
     * Increment the integer value of a hash field by the given number
     * @param key The hash key
     * @param field The field to increment
     * @param increment The amount to increment by
     * @returns Promise that resolves with the new value
     */
    hincrby(key: string | NodeJS.TypedArray | Blob, field: string, increment: string | number): Promise<number>;

    /**
     * Increment the float value of a hash field by the given amount
     * @param key The hash key
     * @param field The field to increment
     * @param increment The amount to increment by
     * @returns Promise that resolves with the new value as a string
     */
    hincrbyfloat(key: string | NodeJS.TypedArray | Blob, field: string, increment: string | number): Promise<string>;
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
