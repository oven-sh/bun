import { EventEmitter } from "node:events";
import { WebSocketServer } from "ws";

const isDebug = process.env.NODE_ENV === "development";

export type WebSocketSignalEventMap = {
  "Signal.listening": [string];
  "Signal.error": [Error];
  "Signal.received": [string];
  "Signal.closed": [];
};

/**
 * Starts a server that listens for signals over a WebSocket.
 */
export class WebSocketSignal extends EventEmitter<WebSocketSignalEventMap> {
  #url: string;
  #server: WebSocketServer;
  #ready: Promise<void>;

  constructor(url: string) {
    super();
    this.#url = url;
    const port = getPortFromUrl(url);
    this.#server = new WebSocketServer({ port });

    this.#server.on("listening", () => this.emit("Signal.listening", this.#url));
    this.#server.on("error", error => this.emit("Signal.error", error));
    this.#server.on("close", () => this.emit("Signal.closed"));
    this.#server.on("connection", socket => {
      socket.on("message", data => {
        this.emit("Signal.received", data.toString());
      });
    });
    this.#ready = new Promise((resolve, reject) => {
      this.#server.on("listening", resolve);
      this.#server.on("error", reject);
    });
  }

  emit<E extends keyof WebSocketSignalEventMap>(event: E, ...args: WebSocketSignalEventMap[E]): boolean {
    if (isDebug) {
      console.log(event, ...args);
    }
    return super.emit(event, ...args);
  }

  /**
   * The WebSocket URL.
   */
  get url(): string {
    return this.#url;
  }

  /**
   * Resolves when the server is listening or rejects if an error occurs.
   */
  get ready(): Promise<void> {
    return this.#ready;
  }

  /**
   * Closes the server.
   */
  close(): void {
    this.#server.close();
  }
}

function getPortFromUrl(url: string): number {
  try {
    const parsedUrl = new URL(url);
    return parseInt(parsedUrl.port, 10) || 0;
  } catch {
    throw new Error(`Invalid WebSocket URL: ${url}`);
  }
}
