import { EventEmitter } from "node:events";
import { WebSocket } from "ws";
import type { JSC } from "../protocol";
import type { Inspector, InspectorEventMap } from "./index";

/**
 * An inspector that communicates with a debugger over a WebSocket.
 */
export class WebSocketInspector extends EventEmitter<InspectorEventMap> implements Inspector {
  #url?: string;
  #webSocket?: WebSocket;
  #ready: Promise<boolean> | undefined;
  #requestId: number;
  #pendingRequests: JSC.Request[];
  #pendingResponses: Map<number, (result: unknown) => void>;

  constructor(url?: string | URL) {
    super();
    this.#url = url ? String(url) : undefined;
    this.#requestId = 1;
    this.#pendingRequests = [];
    this.#pendingResponses = new Map();
  }

  get url(): string {
    return this.#url!;
  }

  async start(url?: string | URL): Promise<boolean> {
    if (url) {
      this.#url = String(url);
    }

    if (!this.#url) {
      this.emit("Inspector.error", new Error("Inspector needs a URL, but none was provided"));
      return false;
    }

    return this.#connect(this.#url);
  }

  async #connect(url: string): Promise<boolean> {
    if (this.#ready) {
      return this.#ready;
    }

    this.close(1001, "Restarting...");
    this.emit("Inspector.connecting", url);

    let webSocket: WebSocket;
    try {
      // @ts-expect-error: Support both Bun and Node.js version of `headers`.
      webSocket = new WebSocket(url, {
        headers: {
          "Ref-Event-Loop": "0",
        },
        finishRequest: (request: import("http").ClientRequest) => {
          request.setHeader("Ref-Event-Loop", "0");
          request.end();
        },
      });
    } catch (cause) {
      this.#close(unknownToError(cause));
      return false;
    }

    webSocket.addEventListener("open", () => {
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

    webSocket.addEventListener("message", ({ data }) => {
      if (typeof data === "string") {
        this.#accept(data);
      } else {
        this.emit("Inspector.error", new Error(`WebSocket received unexpected binary message: ${data.toString()}`));
      }
    });

    webSocket.addEventListener("error", event => {
      this.#close(unknownToError(event));
    });

    webSocket.addEventListener("unexpected-response", () => {
      this.#close(new Error("WebSocket upgrade failed"));
    });

    webSocket.addEventListener("close", ({ code, reason }) => {
      if (code === 1001 || code === 1006) {
        this.#close();
        return;
      }
      this.#close(new Error(`WebSocket closed: ${code} ${reason}`.trimEnd()));
    });

    this.#webSocket = webSocket;

    const ready = new Promise<boolean>(resolve => {
      webSocket.addEventListener("open", () => resolve(true));
      webSocket.addEventListener("close", () => resolve(false));
      webSocket.addEventListener("error", () => resolve(false));
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

      this.#pendingResponses.set(id, done);
      if (this.#send(request)) {
        timerId = +setTimeout(() => done(new Error(`Timed out: ${method}`)), 10_000);
        this.emit("Inspector.request", request);
      } else {
        this.emit("Inspector.pendingRequest", request);
      }
    });
  }

  #send(request: JSC.Request): boolean {
    if (this.#webSocket) {
      const { readyState } = this.#webSocket!;
      if (readyState === WebSocket.OPEN) {
        this.#webSocket.send(JSON.stringify(request));
        return true;
      }
    }

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
    const resolve = this.#pendingResponses.get(id);
    if (!resolve) {
      this.emit("Inspector.error", new Error(`Failed to find matching request for ID: ${id}`));
      return;
    }

    if ("error" in data) {
      const { error } = data;
      const { message } = error;
      resolve(new Error(message));
    } else {
      const { result } = data;
      resolve(result);
    }
  }

  get closed(): boolean {
    if (!this.#webSocket) {
      return true;
    }

    const { readyState } = this.#webSocket;
    switch (readyState) {
      case WebSocket.CLOSED:
      case WebSocket.CLOSING:
        return true;
    }

    return false;
  }

  close(code?: number, reason?: string): void {
    this.#webSocket?.close(code ?? 1001, reason);
  }

  #close(error?: Error): void {
    for (const resolve of this.#pendingResponses.values()) {
      resolve(error ?? new Error("WebSocket closed"));
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
