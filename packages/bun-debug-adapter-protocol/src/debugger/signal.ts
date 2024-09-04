import { EventEmitter } from "node:events";
import type { Server } from "node:net";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const isDebug = process.env.NODE_ENV === "development";

export type UnixSignalEventMap = {
  "Signal.listening": [string];
  "Signal.error": [Error];
  "Signal.received": [string];
  "Signal.closed": [];
};

/**
 * Starts a server that listens for signals on a UNIX domain socket.
 */
export class UnixSignal extends EventEmitter<UnixSignalEventMap> {
  #path: string;
  #server: Server;
  #ready: Promise<void>;

  constructor(path?: string | URL) {
    super();
    this.#path = path ? parseUnixPath(path) : randomUnixPath();
    this.#server = createServer();
    this.#server.on("listening", () => this.emit("Signal.listening", this.#path));
    this.#server.on("error", error => this.emit("Signal.error", error));
    this.#server.on("close", () => this.emit("Signal.closed"));
    this.#server.on("connection", socket => {
      socket.on("data", data => {
        this.emit("Signal.received", data.toString());
      });
    });
    this.#ready = new Promise((resolve, reject) => {
      this.#server.on("listening", resolve);
      this.#server.on("error", reject);
    });
    this.#server.listen(this.#path);
  }

  emit<E extends keyof UnixSignalEventMap>(event: E, ...args: UnixSignalEventMap[E]): boolean {
    if (isDebug) {
      console.log(event, ...args);
    }

    return super.emit(event, ...args);
  }

  /**
   * The path to the UNIX domain socket.
   */
  get url(): string {
    return `unix://${this.#path}`;
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

export function randomUnixPath(): string {
  return join(tmpdir(), `${Math.random().toString(36).slice(2)}.sock`);
}

function parseUnixPath(path: string | URL): string {
  if (typeof path === "string" && path.startsWith("/")) {
    return path;
  }
  try {
    const { pathname } = new URL(path);
    return pathname;
  } catch {
    throw new Error(`Invalid UNIX path: ${path}`);
  }
}
