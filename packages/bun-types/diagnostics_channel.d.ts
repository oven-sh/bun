/**
 * The `node:diagnostics_channel` module provides an API to create named channels
 * to report arbitrary message data for diagnostics purposes.
 *
 * It can be accessed using:
 *
 * ```js
 * import diagnostics_channel from 'node:diagnostics_channel';
 * ```
 *
 * It is intended that a module writer wanting to report diagnostics messages
 * will create one or many top-level channels to report messages through.
 * Channels may also be acquired at runtime but it is not encouraged
 * due to the additional overhead of doing so. Channels may be exported for
 * convenience, but as long as the name is known it can be acquired anywhere.
 *
 * If you intend for your module to produce diagnostics data for others to
 * consume it is recommended that you include documentation of what named
 * channels are used along with the shape of the message data. Channel names
 * should generally include the module name to avoid collisions with data from
 * other modules.
 * @since Bun v0.7.2
 * @see [source](https://github.com/nodejs/node/blob/v20.2.0/lib/diagnostics_channel.js)
 */
declare module "diagnostics_channel" {
  import { AsyncLocalStorage } from "async_hooks";
  // type AsyncLocalStorage<T> = import("async_hooks").AsyncLocalStorage<T>;
  type ChannelListener = (message: unknown, name: string | symbol) => void;
  /**
   * Check if there are active subscribers to the named channel. This is helpful if
   * the message you want to send might be expensive to prepare.
   *
   * This API is optional but helpful when trying to publish messages from very
   * performance-sensitive code.
   *
   * ```js
   * import diagnostics_channel from 'node:diagnostics_channel';
   *
   * if (diagnostics_channel.hasSubscribers('my-channel')) {
   *   // There are subscribers, prepare and publish message
   * }
   * ```
   * @since Bun v0.7.2
   * @param name The channel name
   * @return If there are active subscribers
   */
  function hasSubscribers(name: string | symbol): boolean;
  /**
   * This is the primary entry-point for anyone wanting to publish to a named
   * channel. It produces a channel object which is optimized to reduce overhead at
   * publish time as much as possible.
   *
   * ```js
   * import diagnostics_channel from 'node:diagnostics_channel';
   *
   * const channel = diagnostics_channel.channel('my-channel');
   * ```
   * @since Bun v0.7.2
   * @param name The channel name
   * @return The named channel object
   */
  function channel(name: string | symbol): Channel;
  /**
   * Register a message handler to subscribe to this channel. This message handler
   * will be run synchronously whenever a message is published to the channel. Any
   * errors thrown in the message handler will trigger an `'uncaughtException'`.
   *
   * ```js
   * import diagnostics_channel from 'node:diagnostics_channel';
   *
   * diagnostics_channel.subscribe('my-channel', (message, name) => {
   *   // Received data
   * });
   * ```
   * @since Bun v0.7.2
   * @param name The channel name
   * @param onMessage The handler to receive channel messages
   */
  function subscribe(name: string | symbol, onMessage: ChannelListener): void;
  /**
   * Remove a message handler previously registered to this channel with {@link subscribe}.
   *
   * ```js
   * import diagnostics_channel from 'node:diagnostics_channel';
   *
   * function onMessage(message, name) {
   *   // Received data
   * }
   *
   * diagnostics_channel.subscribe('my-channel', onMessage);
   *
   * diagnostics_channel.unsubscribe('my-channel', onMessage);
   * ```
   * @since Bun v0.7.2
   * @param name The channel name
   * @param onMessage The previous subscribed handler to remove
   * @return `true` if the handler was found, `false` otherwise.
   */
  function unsubscribe(
    name: string | symbol,
    onMessage: ChannelListener,
  ): boolean;
  /**
   * The class `Channel` represents an individual named channel within the data
   * pipeline. It is used to track subscribers and to publish messages when there
   * are subscribers present. It exists as a separate object to avoid channel
   * lookups at publish time, enabling very fast publish speeds and allowing
   * for heavy use while incurring very minimal cost. Channels are created with {@link channel}, constructing a channel directly
   * with `new Channel(name)` is not supported.
   * @since Bun v0.7.2
   */
  class Channel {
    readonly name: string | symbol;
    /**
     * Check if there are active subscribers to this channel. This is helpful if
     * the message you want to send might be expensive to prepare.
     *
     * This API is optional but helpful when trying to publish messages from very
     * performance-sensitive code.
     *
     * ```js
     * import diagnostics_channel from 'node:diagnostics_channel';
     *
     * const channel = diagnostics_channel.channel('my-channel');
     *
     * if (channel.hasSubscribers) {
     *   // There are subscribers, prepare and publish message
     * }
     * ```
     * @since Bun v0.7.2
     */
    readonly hasSubscribers: boolean;
    private constructor(name: string | symbol);
    /**
     * Publish a message to any subscribers to the channel. This will trigger
     * message handlers synchronously so they will execute within the same context.
     *
     * ```js
     * import diagnostics_channel from 'node:diagnostics_channel';
     *
     * const channel = diagnostics_channel.channel('my-channel');
     *
     * channel.publish({
     *   some: 'message',
     * });
     * ```
     * @since Bun v0.7.2
     * @param message The message to send to the channel subscribers
     */
    publish(message: unknown): void;
    /**
     * Register a message handler to subscribe to this channel. This message handler
     * will be run synchronously whenever a message is published to the channel. Any
     * errors thrown in the message handler will trigger an `'uncaughtException'`.
     *
     * ```js
     * import diagnostics_channel from 'node:diagnostics_channel';
     *
     * const channel = diagnostics_channel.channel('my-channel');
     *
     * channel.subscribe((message, name) => {
     *   // Received data
     * });
     * ```
     * @since Bun v0.7.2
     * @deprecated Use {@link subscribe(name, onMessage)}
     * @param onMessage The handler to receive channel messages
     */
    subscribe(onMessage: ChannelListener): void;
    /**
     * Remove a message handler previously registered to this channel with `channel.subscribe(onMessage)`.
     *
     * ```js
     * import diagnostics_channel from 'node:diagnostics_channel';
     *
     * const channel = diagnostics_channel.channel('my-channel');
     *
     * function onMessage(message, name) {
     *   // Received data
     * }
     *
     * channel.subscribe(onMessage);
     *
     * channel.unsubscribe(onMessage);
     * ```
     * @since Bun v0.7.2
     * @deprecated Use {@link unsubscribe(name, onMessage)}
     * @param onMessage The previous subscribed handler to remove
     * @return `true` if the handler was found, `false` otherwise.
     */
    unsubscribe(onMessage: ChannelListener): void;
    bindStore<T>(
      store: AsyncLocalStorage<T>,
      transform?: TransformCallback<T>,
    ): void;
    unbindStore(store: AsyncLocalStorage<unknown>): void;
    runStores(
      context: unknown,
      fn: (...args: unknown[]) => unknown,
      receiver?: unknown,
      ...args: unknown[]
    ): any;
  }
  type TransformCallback<T> = (value: T) => unknown;
  type TracingChannelSubscribers = {
    start?: ChannelListener;
    end?: ChannelListener;
    asyncStart?: ChannelListener;
    asyncEnd?: ChannelListener;
    error?: ChannelListener;
  };
  type TracingChannels = {
    start: Channel;
    end: Channel;
    asyncStart: Channel;
    asyncEnd: Channel;
    error: Channel;
  };
  class TracingChannel implements TracingChannels {
    readonly start: Channel;
    readonly end: Channel;
    readonly asyncStart: Channel;
    readonly asyncEnd: Channel;
    readonly error: Channel;
    subscribe(subscribers: TracingChannelSubscribers): void;
    unsubscribe(subscribers: TracingChannelSubscribers): boolean;
    traceSync<T>(
      fn: (...values: any[]) => T,
      context?: any,
      thisArg?: any,
      ...args: any[]
    ): any;
    tracePromise<T>(
      fn: (...values: any[]) => Promise<T>,
      context?: any,
      thisArg?: any,
      ...args: any[]
    ): Promise<any>;
    traceCallback<T>(
      fn: (...values: any[]) => T,
      position?: number,
      context?: any,
      thisArg?: any,
      ...args: any[]
    ): any;
  }
  function tracingChannel(
    nameOrChannels: string | TracingChannels,
  ): TracingChannel;
}

declare module "node:diagnostics_channel" {
  export * from "diagnostics_channel";
}
