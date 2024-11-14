import { CloseEvent, Event, MessageEvent, WebSocket } from "ws";

type BufferLike = Parameters<WebSocket["send"]>[0];

type RequiredKeys<T, K extends keyof T> = T extends T ? Required<Pick<T, K>> & Omit<T, K> : never;

export interface ReconnectingWebSocketOptions {
  /**
   * The WebSocket protocol(s) to use
   */
  protocols: string | string[];
  /**
   * The timeout in milliseconds before attempting to reconnect during a disconnection
   */
  timeout: number;
  /**
   * The maximum reconnects that are allowed to occur during reconnection
   * @default Infinity
   */
  maxAttempts: number;
  /**
   * Called when the WebSocket connection is opened
   */
  onOpen: (ev: Event) => void;
  /**
   * Called when a message is received from the WebSocket
   * @param ev The message event
   */
  onMessage: (ev: MessageEvent) => void;
  /**
   * Called when the WebSocket is attempting to reconnect
   * @param ev The event object, which could be a close event or a generic event.
   */
  onReconnect: (ev: Event | CloseEvent) => void;
  /**
   * Called when the maximum number of reconnects exceeds maxAttempts.
   * @param ev The event object, which could be a close event or a generic event.
   */
  onDidExhaustMaxAttempts: (ev: Event | CloseEvent) => void;
  /**
   * Called when the WebSocket connection is closed
   * @param ev The close event
   */
  onClose: (ev: CloseEvent) => void;
  /**
   * Called when an error occurs with the WebSocket connection
   * @param ev The error event
   */
  onError: (ev: Event) => void;
}

export class ReconnectingWebSocket {
  private ws: WebSocket | null = null;
  private attempts = 0;
  private timer: ReturnType<typeof setTimeout> | null | undefined = null;

  private readonly url: string | URL;
  private readonly options: RequiredKeys<Partial<ReconnectingWebSocketOptions>, "maxAttempts">;

  /**
   * Creates a new instance of the ReconnectingWebSocket class
   * @param url The URL as a string or a URL object
   * @param options The options for the WebSocket connection
   */
  public constructor(url: string | URL, options: Partial<ReconnectingWebSocketOptions> = {}) {
    this.url = url;

    this.options = {
      ...options,
      maxAttempts: options.maxAttempts ?? Infinity,
    };
  }

  /**
   * Sends data to the server
   * @param data The data to send to the WebSocket server
   */
  public send(data: BufferLike) {
    if (!this.ws) {
      throw new Error("Can not send before a socket exists. Call `.open()` to start a connection");
    }

    this.ws.send(data);
  }

  /**
   * Closes the WebSocket connection or connection attempt, if any. This will cancel any reconnection attempts
   * and clear the timeout. You can call `.open()` again to reconnect.
   *
   * @param code The status code explaining why the connection was closed
   * @param reaso The reason why the connection was closed
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WebSocket/close)
   */
  public close(code?: number, reason?: string) {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    if (this.ws) {
      this.ws.close(code || 1000, reason);
    }
  }

  /**
   * Connects to the WebSocket server
   * @returns This instance of the ReconnectingWebSocket class
   */
  public open(through?: (ws: WebSocket) => void) {
    this.ws = new WebSocket(this.url, this.options.protocols ?? []);

    through?.(this.ws);

    this.ws.onmessage = event => {
      this.options.onMessage?.(event);
    };

    this.ws.onopen = e => {
      this.options.onOpen?.(e);
      this.attempts = 0;
    };

    this.ws.onclose = e => {
      if (e.code !== 1000 && e.code !== 1001 && e.code !== 1005) {
        this.reconnect(e);
      }

      this.options.onClose?.(e);
    };

    this.ws.onerror = e => {
      if ("code" in e && e.code === "ECONNREFUSED") {
        this.reconnect(e);
      } else {
        this.options.onError?.(e);
      }
    };

    return this;
  }

  /**
   * Forcefully reconnects the WebSocket connection
   * @param e The event that caused the reconnection
   */
  private reconnect(e: Event | CloseEvent) {
    if (this.ws) {
      this.ws.close(1000, "Reconnecting");
    }

    if (this.timer !== undefined && this.attempts++ < this.options.maxAttempts) {
      this.timer = setTimeout(() => {
        this.options.onReconnect?.(e);

        this.open();
      }, this.options.timeout || 1000);
    } else {
      this.options.onDidExhaustMaxAttempts?.(e);
    }
  }
}
