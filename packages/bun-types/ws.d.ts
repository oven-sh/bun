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
declare module "ws" {
  import {
    IncomingMessage,
    OutgoingHttpHeaders,
    Server as HTTPServer,
  } from "http";
  import { Duplex, EventEmitter } from "stream";
  // import {Server as HTTPServer} from "http";
  import { Server as HTTPSServer } from "https";
  var WebSocket: typeof global.WebSocket;
  interface WebSocket extends globalThis.WebSocket {}

  type VerifyClientCallbackSync<
    Request extends IncomingMessage = IncomingMessage,
  > = (info: { origin: string; secure: boolean; req: Request }) => boolean;
  type VerifyClientCallbackAsync<
    Request extends IncomingMessage = IncomingMessage,
  > = (
    info: { origin: string; secure: boolean; req: Request },
    callback: (
      res: boolean,
      code?: number,
      message?: string,
      headers?: OutgoingHttpHeaders,
    ) => void,
  ) => void;

  interface WebSocketServerOptions<
    U extends typeof WebSocket = typeof WebSocket,
    V extends typeof IncomingMessage = typeof IncomingMessage,
  > {
    host?: string | undefined;
    port?: number | undefined;
    backlog?: number | undefined;
    server?: HTTPServer<V> | HTTPSServer<V> | undefined;
    verifyClient?:
      | VerifyClientCallbackAsync<InstanceType<V>>
      | VerifyClientCallbackSync<InstanceType<V>>
      | undefined;
    handleProtocols?: (
      protocols: Set<string>,
      request: InstanceType<V>,
    ) => string | false;
    path?: string | undefined;
    noServer?: boolean | undefined;
    clientTracking?: boolean | undefined;
    perMessageDeflate?: boolean; // | PerMessageDeflateOptions | undefined;
    // maxPayload?: number | undefined;
    // skipUTF8Validation?: boolean | undefined;
    WebSocket?: U | undefined;
  }

  interface AddressInfo {
    address: string;
    family: string;
    port: number;
  }

  // WebSocket Server
  class WebSocketServer<
    T extends typeof WebSocket = typeof WebSocket,
    U extends typeof IncomingMessage = typeof IncomingMessage,
  > extends EventEmitter {
    options: WebSocketServerOptions<T, U>;
    path: string;
    clients: Set<InstanceType<T>>;

    constructor(options?: WebSocketServerOptions<T, U>, callback?: () => void);

    address(): AddressInfo | string;
    close(cb?: (err?: Error) => void): void;
    handleUpgrade(
      request: InstanceType<U>,
      socket: Duplex,
      upgradeHead: Buffer,
      callback: (client: InstanceType<T>, request: InstanceType<U>) => void,
    ): void;
    shouldHandle(request: InstanceType<U>): boolean | Promise<boolean>;

    // Events
    on(
      event: "connection",
      cb: (
        this: WebSocketServer<T>,
        socket: InstanceType<T>,
        request: InstanceType<U>,
      ) => void,
    ): this;
    on(
      event: "error",
      cb: (this: WebSocketServer<T>, error: Error) => void,
    ): this;
    on(
      event: "headers",
      cb: (
        this: WebSocketServer<T>,
        headers: string[],
        request: InstanceType<U>,
      ) => void,
    ): this;
    on(
      event: "close" | "listening",
      cb: (this: WebSocketServer<T>) => void,
    ): this;
    on(
      event: string | symbol,
      listener: (this: WebSocketServer<T>, ...args: any[]) => void,
    ): this;

    once(
      event: "connection",
      cb: (
        this: WebSocketServer<T>,
        socket: InstanceType<T>,
        request: InstanceType<U>,
      ) => void,
    ): this;
    once(
      event: "error",
      cb: (this: WebSocketServer<T>, error: Error) => void,
    ): this;
    once(
      event: "headers",
      cb: (
        this: WebSocketServer<T>,
        headers: string[],
        request: InstanceType<U>,
      ) => void,
    ): this;
    once(
      event: "close" | "listening",
      cb: (this: WebSocketServer<T>) => void,
    ): this;
    once(
      event: string | symbol,
      listener: (this: WebSocketServer<T>, ...args: any[]) => void,
    ): this;

    off(
      event: "connection",
      cb: (
        this: WebSocketServer<T>,
        socket: InstanceType<T>,
        request: InstanceType<U>,
      ) => void,
    ): this;
    off(
      event: "error",
      cb: (this: WebSocketServer<T>, error: Error) => void,
    ): this;
    off(
      event: "headers",
      cb: (
        this: WebSocketServer<T>,
        headers: string[],
        request: InstanceType<U>,
      ) => void,
    ): this;
    off(
      event: "close" | "listening",
      cb: (this: WebSocketServer<T>) => void,
    ): this;
    off(
      event: string | symbol,
      listener: (this: WebSocketServer<T>, ...args: any[]) => void,
    ): this;

    addListener(
      event: "connection",
      cb: (client: InstanceType<T>, request: InstanceType<U>) => void,
    ): this;
    addListener(event: "error", cb: (err: Error) => void): this;
    addListener(
      event: "headers",
      cb: (headers: string[], request: InstanceType<U>) => void,
    ): this;
    addListener(event: "close" | "listening", cb: () => void): this;
    addListener(
      event: string | symbol,
      listener: (...args: any[]) => void,
    ): this;

    removeListener(
      event: "connection",
      cb: (client: InstanceType<T>, request: InstanceType<U>) => void,
    ): this;
    removeListener(event: "error", cb: (err: Error) => void): this;
    removeListener(
      event: "headers",
      cb: (headers: string[], request: InstanceType<U>) => void,
    ): this;
    removeListener(event: "close" | "listening", cb: () => void): this;
    removeListener(
      event: string | symbol,
      listener: (...args: any[]) => void,
    ): this;
  }
}
