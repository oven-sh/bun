import { EventEmitter } from "node:events";
import { Socket } from "node:net";
import { SocketFramer } from "../../../bun-debug-adapter-protocol/src/debugger/node-socket-framer.js";
import type { JSC } from "../protocol";
import type { Inspector, InspectorEventMap } from "./index";

/**
 * An inspector that communicates with a debugger over a (unix) socket.
 * This is used in the extension as follows:
 *
 * 1. Extension sets environment variable `BUN_INSPECT_NOTIFY` inside of all vscode terminals.
 *    This is a path to a unix socket that the extension will listen on.
 * 2. Bun reads it and connects to the socket, setting up a reverse connection for sending DAP
 *    messages.
 */
export class NodeSocketInspector extends EventEmitter<InspectorEventMap> implements Inspector {
  #ready: Promise<boolean> | undefined;
  #socket: Socket;
  #requestId: number;
  #pendingRequests: JSC.Request[];
  #pendingResponses: Map<
    number,
    {
      request: JSC.Request;
      done: (result: unknown) => void;
    }
  >;
  #framer: SocketFramer;

  constructor(socket: Socket) {
    super();
    this.#socket = socket;
    this.#requestId = 1;
    this.#pendingRequests = [];
    this.#pendingResponses = new Map();

    this.#framer = new SocketFramer(socket, message => {
      if (Array.isArray(message)) {
        for (const m of message) {
          this.#accept(m);
        }
      } else {
        this.#accept(message);
      }
    });
  }

  private onConnectOrImmediately(cb: () => void) {
    const isAlreadyConnected = this.#socket.connecting === false;

    if (isAlreadyConnected) {
      cb();
    } else {
      this.#socket.once("connect", cb);
    }
  }

  async start(): Promise<boolean> {
    if (this.#ready) {
      return this.#ready;
    }

    if (this.closed) {
      this.close();
      const addressWithPort = this.#socket.remoteAddress + ":" + this.#socket.remotePort;
      this.emit("Inspector.connecting", addressWithPort);
    }

    const socket = this.#socket;

    this.onConnectOrImmediately(() => {
      this.emit("Inspector.connected");

      for (let i = 0; i < this.#pendingRequests.length; i++) {
        const request = this.#pendingRequests[i];

        if (this.#send(request)) {
          this.emit("Inspector.request", request);
        } else {
          this.#pendingRequests = this.#pendingRequests.slice(i);
          break;
        }
      }
    });

    socket.on("data", data => this.#framer.onData(data));

    socket.on("error", error => {
      this.#close(unknownToError(error));
    });

    socket.on("close", hadError => {
      if (hadError) {
        this.#close(new Error("Socket closed due to a transmission error"));
      } else {
        this.#close();
      }
    });

    const ready = new Promise<boolean>(resolve => {
      if (socket.connecting) {
        socket.on("connect", () => resolve(true));
      } else {
        resolve(true);
      }
      socket.on("close", () => resolve(false));
      socket.on("error", () => resolve(false));
    }).finally(() => {
      this.#ready = undefined;
    });

    this.#ready = ready;

    return ready;
  }

  send<M extends keyof JSC.RequestMap & keyof JSC.ResponseMap>(
    method: M,
    params?: JSC.RequestMap[M] | undefined,
  ): Promise<JSC.ResponseMap[M]> {
    const id = this.#requestId++;
    const request = {
      id,
      method,
      params: params ?? {},
    };

    return new Promise((resolve, reject) => {
      let timerId: number | undefined;
      const done = (result: any) => {
        this.#pendingResponses.delete(id);
        if (timerId) {
          clearTimeout(timerId);
        }
        if (result instanceof Error) {
          reject(result);
        } else {
          resolve(result);
        }
      };

      this.#pendingResponses.set(id, {
        request: request,
        done: done,
      });

      if (this.#send(request)) {
        timerId = +setTimeout(() => done(new Error(`Timed out: ${method}`)), 10_000);
        this.emit("Inspector.request", request);
      } else {
        this.emit("Inspector.pendingRequest", request);
      }
    });
  }

  #send(request: JSC.Request): boolean {
    this.#framer.send(JSON.stringify(request));

    if (!this.#pendingRequests.includes(request)) {
      this.#pendingRequests.push(request);
    }

    return false;
  }

  #accept(message: string): void {
    let data: JSC.Event | JSC.Response;
    try {
      data = JSON.parse(message);
    } catch (cause) {
      this.emit("Inspector.error", new Error(`Failed to parse message: ${message}`, { cause }));
      return;
    }

    if (!("id" in data)) {
      this.emit("Inspector.event", data);
      const { method, params } = data;
      this.emit(method, params);
      return;
    }

    this.emit("Inspector.response", data);

    const { id } = data;
    const handle = this.#pendingResponses.get(id);
    if (!handle) {
      this.emit("Inspector.error", new Error(`Failed to find matching request for ID: ${id}`));
      return;
    }

    if ("error" in data) {
      const { error } = data;
      const { message } = error;
      handle.done(new Error(message));
    } else {
      const { result } = data;
      handle.done(result);
    }
  }

  get closed(): boolean {
    return !this.#socket.writable;
  }

  close(): void {
    this.#socket?.end();
  }

  #close(error?: Error): void {
    for (const handle of this.#pendingResponses.values()) {
      handle.done(error ?? new Error("Socket closed while waiting for: " + handle.request.method));
    }

    this.#pendingResponses.clear();

    if (error) {
      this.emit("Inspector.error", error);
    }

    this.emit("Inspector.disconnected", error);
  }
}

function unknownToError(input: unknown): Error {
  if (input instanceof Error) {
    return input;
  }

  if (typeof input === "object" && input !== null && "message" in input) {
    const { message } = input;
    return new Error(`${message}`);
  }

  return new Error(`${input}`);
}
