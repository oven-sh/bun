import { EventEmitter } from "node:events";
import type { Server, Socket } from "node:net";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";

const isDebug = process.env.NODE_ENV === "development";

export type UnixSignalEventMap = {
  "Signal.listening": [string];
  "Signal.error": [Error];
  "Signal.received": [string];
  "Signal.closed": [];
  "Signal.Socket.closed": [socket: Socket];
  "Signal.Socket.connect": [socket: Socket];
};

/**
 * Starts a server that listens for signals on a UNIX domain socket.
 */
export class UnixSignal extends EventEmitter<UnixSignalEventMap> {
  #path: string;
  #server: Server;
  #ready: Promise<void>;

  constructor(path?: string | URL | undefined) {
    super();
    this.#path = path ? parseUnixPath(path) : randomUnixPath();
    this.#server = createServer();
    this.#server.on("listening", () => this.emit("Signal.listening", this.#path));
    this.#server.on("error", error => this.emit("Signal.error", error));
    this.#server.on("close", () => this.emit("Signal.closed"));
    this.#server.on("connection", socket => {
      this.emit("Signal.Socket.connect", socket);
      socket.on("data", data => {
        this.emit("Signal.received", data.toString());
      });
      socket.on("close", () => {
        this.emit("Signal.Socket.closed", socket);
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

    return super.emit(event, ...(args as never));
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

/**
 * Validates that a Unix socket path is safe to use.
 * Only allows paths within the system's temporary directory to prevent path traversal attacks.
 *
 * @throws Error if the path is not within the allowed directories
 */
function validateUnixSocketPath(socketPath: string): void {
  const normalizedPath = normalize(socketPath);
  const tempDir = tmpdir();

  // Check for path traversal attempts
  if (normalizedPath.includes("..")) {
    throw new Error(`Unix socket path contains path traversal: ${socketPath}`);
  }

  // Only allow sockets in the temp directory
  if (!normalizedPath.startsWith(tempDir)) {
    throw new Error(
      `Unix socket path must be within the temp directory (${tempDir}). ` +
        `Attempted path: ${normalizedPath}`,
    );
  }
}

function parseUnixPath(path: string | URL): string {
  let socketPath: string;

  if (typeof path === "string" && path.startsWith("/")) {
    socketPath = path;
  } else {
    try {
      const { pathname } = new URL(path);
      socketPath = pathname;
    } catch {
      throw new Error(`Invalid UNIX path: ${path}`);
    }
  }

  // Validate the path is within allowed directories
  validateUnixSocketPath(socketPath);
  return socketPath;
}

export type TCPSocketSignalEventMap = {
  "Signal.listening": [];
  "Signal.error": [Error];
  "Signal.closed": [];
  "Signal.received": [string];
  "Signal.Socket.closed": [socket: Socket];
  "Signal.Socket.connect": [socket: Socket];
};

export class TCPSocketSignal extends EventEmitter {
  #port: number;
  #server: ReturnType<typeof createServer>;
  #ready: Promise<void>;

  constructor(port: number) {
    super();
    this.#port = port;

    this.#server = createServer((socket: Socket) => {
      this.emit("Signal.Socket.connect", socket);

      socket.on("data", data => {
        this.emit("Signal.received", data.toString());
      });

      socket.on("error", error => {
        this.emit("Signal.error", error);
      });

      socket.on("close", () => {
        this.emit("Signal.Socket.closed", socket);
      });
    });

    this.#server.on("close", () => {
      this.emit("Signal.closed");
    });

    this.#ready = new Promise((resolve, reject) => {
      this.#server.listen(this.#port, () => {
        this.emit("Signal.listening");
        resolve();
      });
      this.#server.on("error", reject);
    });
  }

  emit<E extends keyof TCPSocketSignalEventMap>(event: E, ...args: TCPSocketSignalEventMap[E]): boolean {
    if (isDebug) {
      console.log(event, ...args);
    }
    return super.emit(event, ...args);
  }

  /**
   * The TCP port.
   */
  get port(): number {
    return this.#port;
  }

  get url(): string {
    return `tcp://127.0.0.1:${this.#port}`;
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
