declare module "bun" {
  export interface ValkeyOptions {
    url?: string;
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    db?: number;
    tls?: boolean;
  }

  export class ValkeyClient {
    constructor(url?: string, options?: ValkeyOptions);

    /**
     * Whether the client is connected to the Valkey server
     */
    readonly connected: boolean;

    /**
     * Callback fired when the client connects to the Valkey server
     */
    onconnect: (() => void) | null;

    /**
     * Callback fired when the client disconnects from the Valkey server
     */
    onclose: (() => void) | null;

    /**
     * Connect to the Valkey server
     */
    connect(): Promise<void>;

    /**
     * Disconnect from the Valkey server
     */
    disconnect(): Promise<void>;

    /**
     * Send a raw command to the Valkey server
     */
    sendCommand(command: string, args: string[]): Promise<any>;

    /**
     * Get the value of a key
     */
    get(key: string): Promise<string | null>;

    /**
     * Set the value of a key
     */
    set(key: string, value: string): Promise<string>;

    /**
     * Delete a key
     */
    del(key: string): Promise<number>;

    /**
     * Increment the integer value of a key by one
     */
    incr(key: string): Promise<number>;

    /**
     * Decrement the integer value of a key by one
     */
    decr(key: string): Promise<number>;

    /**
     * Determine if a key exists
     */
    exists(key: string): Promise<boolean>;

    /**
     * Set a key's time to live in seconds
     */
    expire(key: string, seconds: number): Promise<number>;

    /**
     * Get the time to live for a key in seconds
     */
    ttl(key: string): Promise<number>;

    /**
     * Set the string value of a hash field
     */
    hmset(key: string, field: string, value: string): Promise<string>;

    /**
     * Get the values of all the given hash fields
     */
    hmget(key: string, field: string): Promise<string[]>;

    /**
     * Determine if a hash field exists
     */
    sismember(key: string, member: string): Promise<boolean>;

    /**
     * Add one or more members to a set
     */
    sadd(key: string, member: string): Promise<number>;

    /**
     * Remove one or more members from a set
     */
    srem(key: string, member: string): Promise<number>;

    /**
     * Get all the members in a set
     */
    smembers(key: string): Promise<string[]>;

    /**
     * Get one or multiple random members from a set
     */
    srandmember(key: string): Promise<string>;

    /**
     * Remove and return one or multiple random members from a set
     */
    spop(key: string): Promise<string>;

    /**
     * Increment the integer value of a hash field by the given number
     */
    hincrby(key: string, field: string, increment: number): Promise<number>;

    /**
     * Increment the float value of a hash field by the given amount
     */
    hincrbyfloat(key: string, field: string, increment: number): Promise<string>;
  }
}
