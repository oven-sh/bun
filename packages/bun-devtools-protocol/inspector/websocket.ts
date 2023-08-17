import type {
  Inspector,
  InspectorListener,
  AnyEventMap,
  AnyRequestMap,
  AnyResponseMap,
  AnyEvent,
  AnyResponse,
} from ".";
import { JSC } from "..";
import { WebSocket } from "ws";

export type WebSocketInspectorOptions<EventMap extends AnyEventMap = JSC.EventMap> = {
  url?: string | URL;
  listener?: InspectorListener<EventMap>;
};

export class WebSocketInspector<
  RequestMap extends AnyRequestMap = JSC.RequestMap,
  ResponseMap extends AnyResponseMap = JSC.ResponseMap,
  EventMap extends AnyEventMap = JSC.EventMap,
> implements Inspector<RequestMap, ResponseMap, EventMap>
{
  #url?: URL;
  #webSocket?: WebSocket;
  #requestId: number;
  #pendingRequests: Map<number, (result: unknown) => void>;
  #pendingMessages: string[];
  #listener: InspectorListener<EventMap>;

  constructor({ url, listener }: WebSocketInspectorOptions<EventMap>) {
    this.#url = url ? new URL(url) : undefined;
    this.#listener = listener ?? {};
    this.#requestId = 1;
    this.#pendingRequests = new Map();
    this.#pendingMessages = [];
  }

  connect(url?: string | URL): void {
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
    if (this.#webSocket) {
      this.#webSocket.close();
    }
    let webSocket: WebSocket;
    try {
      webSocket = new WebSocket(this.#url);
    } catch (error) {
      this.#close(unknownToError(error));
      return;
    }
    webSocket.addEventListener("open", () => {
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
      this.#close(unknownToError(event));
    });
    webSocket.addEventListener("unexpected-response", () => {
      this.#close(new Error("WebSocket upgrade failed"));
    });
    webSocket.addEventListener("close", ({ code, reason }) => {
      this.#close(new Error(`WebSocket closed: ${code} ${reason}`.trimEnd()));
    });
    this.#webSocket = webSocket;
  }

  send<M extends keyof RequestMap & keyof ResponseMap>(
    method: M,
    params?: RequestMap[M] | undefined,
  ): Promise<ResponseMap[M]> {
    const id = this.#requestId++;
    const request = { id, method, params };
    console.log("[jsc] -->", request);
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
    let event: AnyEvent | AnyResponse;
    try {
      event = JSON.parse(message);
    } catch (error) {
      console.error("Failed to parse message:", message);
      return;
    }
    console.log("[jsc] <--", event);
    if ("id" in event) {
      const { id } = event;
      const resolve = this.#pendingRequests.get(id);
      if (!resolve) {
        console.error(`Failed to accept response for unknown ID ${id}:`, event);
        return;
      }
      this.#pendingRequests.delete(id);
      if ("error" in event) {
        const { error } = event;
        const { message, code } = error;
        resolve(new Error(`${message} [code: ${code}]`));
      } else {
        const { result } = event;
        resolve(result);
      }
    } else {
      const { method, params } = event;
      try {
        // @ts-ignore
        this.#listener[method]?.(params);
      } catch (error) {
        console.error(`Failed to accept ${method} event:`, error);
        return;
      }
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
    this.#webSocket?.close(code, reason);
  }

  #close(error: Error): void {
    console.log("[jsc]", error);
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
