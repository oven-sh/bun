import { WebSocket } from "ws";
import { inspect } from "node:util";

import type { JSC } from "../types/jsc";
export type { JSC };

export type JSCClientOptions = {
  url: string | URL;
  retry?: boolean;
  onEvent?: (event: JSC.Event) => void;
  onRequest?: (request: JSC.Request) => void;
  onResponse?: (response: JSC.Response) => void;
  onError?: (error: Error) => void;
  onClose?: (code: number, reason: string) => void;
};

export class JSCClient {
  #options: JSCClientOptions;
  #requestId: number;
  #pendingMessages: string[];
  #pendingRequests: Map<number, (result: unknown) => void>;
  #webSocket?: WebSocket;
  #ready?: Promise<void>;

  constructor(options: JSCClientOptions) {
    this.#options = options;
    this.#requestId = 1;
    this.#pendingMessages = [];
    this.#pendingRequests = new Map();
  }

  get webSocket(): WebSocket {
    if (!this.#webSocket) {
      this.#ready = this.#connect();
    }
    return this.#webSocket!;
  }

  get ready(): Promise<void> {
    if (!this.#ready) {
      this.#ready = this.#connect();
    }
    return this.#ready;
  }

  #connect(): Promise<void> {
    const { url, retry, onError, onResponse, onEvent, onClose } = this.#options;
    this.#webSocket = new WebSocket(url);
    let didConnect = false;
    return new Promise<void>((resolve, reject) => {
      this.#webSocket.addEventListener("open", () => {
        for (const message of this.#pendingMessages) {
          this.#send(message);
        }
        this.#pendingMessages.length = 0;
        didConnect = true;
        resolve();
      });
      this.#webSocket.addEventListener("message", ({ data }) => {
        let received: JSC.Event | JSC.Response;
        try {
          received = JSON.parse(data.toString());
        } catch {
          const error = new Error(`Invalid WebSocket data: ${inspect(data)}`);
          onError?.(error);
          return;
        }
        if ("id" in received) {
          onResponse?.(received);
          if ("error" in received) {
            const { message, code = "?" } = received.error;
            const error = new Error(`${message} [code: ${code}]`);
            onError?.(error);
            this.#pendingRequests.get(received.id)?.(error);
          } else {
            this.#pendingRequests.get(received.id)?.(received.result);
          }
        } else {
          onEvent?.(received);
        }
      });
      this.#webSocket.addEventListener("error", (event) => {
        const message = event[Symbol("kMessage")] ?? inspect(event);
        const error = new Error(`WebSocket error: ${message}`);
        reject(error);
      });
      this.#webSocket.addEventListener("close", ({ code, reason = "" }) => {
        if (didConnect) {
          onClose?.(code, reason);
        } else {
          const error = new Error(`WebSocket closed: ${code} ${reason}`.trimEnd());
          reject(error);
        }
      });
    }).catch((error) => {
      if (!didConnect && retry !== false) {
        return new Promise((resolve, reject) => {
          setTimeout(() => {
            this.#connect().then(resolve, reject);
          }, 1000);
        });
      }
      onError?.(error);
      throw error;
    });
  }

  #send(message: string): void {
    const { webSocket } = this;
    const { readyState } = webSocket;
    if (readyState === WebSocket.OPEN) {
      webSocket.send(message);
    } else if (readyState === WebSocket.CONNECTING) {
      if (!this.#pendingMessages.includes(message)) {
        this.#pendingMessages.push(message);
      }
    } else {
      const closed = readyState === WebSocket.CLOSING ? "closing" : "closed";
      throw new Error(`WebSocket is ${closed}`);
    }
  }

  async fetch<T extends keyof JSC.RequestMap>(
    method: T,
    params?: JSC.Request<T>["params"]
  ): Promise<JSC.ResponseMap[T]> {
    const request: JSC.Request<T> = {
      id: this.#requestId++,
      method,
      params,
    };
    this.#options.onRequest?.(request);
    return new Promise((resolve, reject) => {
      const done = (result: Error | JSC.ResponseMap[T]) => {
        this.#pendingRequests.delete(request.id);
        if (result instanceof Error) {
          reject(result);
        } else {
          resolve(result);
        }
      };
      this.#pendingRequests.set(request.id, done);
      this.#send(JSON.stringify(request));
    });
  }

  close(): void {
    this.#webSocket?.close();
  }
}
