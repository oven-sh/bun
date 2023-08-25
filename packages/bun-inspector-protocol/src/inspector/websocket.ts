import type { Inspector, InspectorListener } from ".";
import type { JSC } from "../protocol";
import { WebSocket } from "ws";

export type WebSocketInspectorOptions = {
  url?: string | URL;
  listener?: InspectorListener;
  logger?: (...messages: unknown[]) => void;
};

/**
 * An inspector that communicates with a debugger over a WebSocket.
 */
export class WebSocketInspector implements Inspector {
  #url?: URL;
  #webSocket?: WebSocket;
  #requestId: number;
  #pendingRequests: Map<number, (result: unknown) => void>;
  #pendingMessages: string[];
  #listener: InspectorListener;
  #log: (...messages: unknown[]) => void;

  constructor({ url, listener, logger }: WebSocketInspectorOptions) {
    this.#url = url ? new URL(url) : undefined;
    this.#requestId = 1;
    this.#pendingRequests = new Map();
    this.#pendingMessages = [];
    this.#listener = listener ?? {};
    this.#log = logger ?? (() => {});
  }

  start(url?: string | URL): void {
    if (url) {
      this.#url = new URL(url);
    }
    if (this.#url) {
      this.#connect();
    }
  }

  #connect(): void {
    if (!this.#url) {
      return;
    }
    this.#webSocket?.close();

    let webSocket: WebSocket;
    try {
      this.#log("connecting:", this.#url.href);
      webSocket = new WebSocket(this.#url, {
        headers: {
          "Ref-Event-Loop": "0",
        },
      });
    } catch (error) {
      this.#close(unknownToError(error));
      return;
    }

    webSocket.addEventListener("open", () => {
      this.#log("connected");

      for (const message of this.#pendingMessages) {
        this.#send(message);
      }

      this.#pendingMessages.length = 0;
      this.#listener["Inspector.connected"]?.();
    });

    webSocket.addEventListener("message", ({ data }) => {
      if (typeof data === "string") {
        this.accept(data);
      }
    });

    webSocket.addEventListener("error", event => {
      this.#log("error:", event);
      this.#close(unknownToError(event));
    });

    webSocket.addEventListener("unexpected-response", () => {
      this.#log("unexpected-response");
      this.#close(new Error("WebSocket upgrade failed"));
    });

    webSocket.addEventListener("close", ({ code, reason }) => {
      this.#log("closed:", code, reason);

      if (code === 1001) {
        this.#close();
      } else {
        this.#close(new Error(`WebSocket closed: ${code} ${reason}`.trimEnd()));
      }
    });

    this.#webSocket = webSocket;
  }

  send<M extends keyof JSC.RequestMap & keyof JSC.ResponseMap>(
    method: M,
    params?: JSC.RequestMap[M] | undefined,
  ): Promise<JSC.ResponseMap[M]> {
    const id = this.#requestId++;
    const request = { id, method, params };

    this.#log("-->", request);

    return new Promise((resolve, reject) => {
      const done = (result: any) => {
        this.#pendingRequests.delete(id);
        if (result instanceof Error) {
          reject(result);
        } else {
          resolve(result);
        }
      };

      this.#pendingRequests.set(id, done);
      this.#send(JSON.stringify(request));
    });
  }

  #send(message: string): void {
    if (this.#webSocket) {
      const { readyState } = this.#webSocket!;
      if (readyState === WebSocket.OPEN) {
        this.#webSocket.send(message);
      }
      return;
    }

    if (!this.#pendingMessages.includes(message)) {
      this.#pendingMessages.push(message);
    }
  }

  accept(message: string): void {
    let event: JSC.Event | JSC.Response;
    try {
      event = JSON.parse(message);
    } catch (error) {
      this.#log("Failed to parse message:", message);
      return;
    }

    this.#log("<--", event);

    if (!("id" in event)) {
      const { method, params } = event;
      try {
        this.#listener[method]?.(params as any);
      } catch (error) {
        this.#log(`Failed to accept ${method} event:`, error);
      }
      return;
    }

    const { id } = event;
    const resolve = this.#pendingRequests.get(id);
    if (!resolve) {
      this.#log("Failed to accept response with unknown ID:", id);
      return;
    }

    this.#pendingRequests.delete(id);
    if ("error" in event) {
      const { error } = event;
      const { message } = error;
      resolve(new Error(message));
    } else {
      const { result } = event;
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
    try {
      this.#listener["Inspector.disconnected"]?.(error);
    } finally {
      for (const resolve of this.#pendingRequests.values()) {
        resolve(error ?? new Error("WebSocket closed"));
      }
      this.#pendingRequests.clear();
    }
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
