// A DevTools client for JavaScriptCore.

import type { JSC } from "..";

type ClientOptions = {
  url: string | URL;
  event?: (event: JSC.Event<keyof JSC.EventMap>) => void;
  request?: (request: JSC.Request<keyof JSC.RequestMap>) => void;
  response?: (response: JSC.Response<keyof JSC.ResponseMap>) => void;
};

class Client {
  #webSocket: WebSocket;
  #requestId: number;
  #pendingMessages: string[];
  #pendingRequests: Map<number, AbortController>;
  #ready: Promise<void>;

  constructor(options: ClientOptions) {
    this.#webSocket = new WebSocket(options.url);
    this.#requestId = 1;
    this.#pendingMessages = [];
    this.#pendingRequests = new Map();
    this.#ready = new Promise((resolve, reject) => {
      this.#webSocket.addEventListener("open", () => {
        for (const message of this.#pendingMessages) {
          this.#send(message);
        }
        this.#pendingMessages.length = 0;
        resolve();
      });
      this.#webSocket.addEventListener("message", ({ data }) => {
        let response;
        try {
          response = { ...JSON.parse(data) };
        } catch {
          console.error("Received an invalid message:", data);
          return;
        }
        const { id, error, result, method, params } = response;
        if (method && params) {
          options.event?.(response);
        } else if (id && (result || error)) {
          try {
            options.response?.(response);
          } finally {
            const abort = this.#pendingRequests.get(id ?? -1);
            if (!abort) {
              console.error("Received an unexpected message:", response);
              return;
            }
            if (error) {
              abort.abort(new Error(JSON.stringify(error)));
            } else {
              abort.abort(result);
            }
          }
        } else {
          console.error("Received an unexpected message:", response);
        }
      });
      this.#webSocket.addEventListener("error", (error) => {
        reject(error);
      });
      this.#webSocket.addEventListener("close", ({ code, reason = ""}) => {
        reject(new Error(`WebSocket closed: ${code} ${reason}`.trimEnd()));
      });
    });
  }

  get ready(): Promise<void> {
    return this.#ready;
  }

  #send(message: string): void {
    const { readyState } = this.#webSocket;
    if (readyState === WebSocket.OPEN) {
      this.#webSocket.send(message);
    } else if (readyState === WebSocket.CONNECTING) {
      this.#pendingMessages.push(message);
    } else {
      const closed = readyState === WebSocket.CLOSING ? "closing" : "closed";
      throw new Error(`WebSocket is ${closed}`);
    }
  }

  async fetch<T extends keyof JSC.RequestMap>(method: T, params: JSC.Request<T>["params"]): Promise<JSC.Response<T>> {
    const request: JSC.Request<T> = {
      id: this.#requestId++,
      method,
      params,
    };
    return new Promise((resolve, reject) => {
      const abort = new AbortController();
      abort.signal.addEventListener("abort", () => {
        this.#pendingRequests.delete(request.id);
        const { reason } = abort.signal;
        if (reason instanceof Error) {
          reject(reason);
        } else {
          resolve(reason);
        }
      });
      this.#pendingRequests.set(request.id, abort);
      this.#send(JSON.stringify(request));
    });
  }
}

const client = new Client({
  url: "ws://localhost:9229",
  event: (event) => console.log("EVENT:", event),
  request: (request) => console.log("REQUEST:", request),
  response: (response) => console.log("RESPONSE:", response),
});
await client.ready;

while (true) {
  const [method, ...param] = prompt(">")?.split(" ") ?? [];
  if (!method.trim()) {
    continue;
  }
  const params = !param?.length ? {} : JSON.parse(eval(`JSON.stringify(${param.join(" ")})`));
  try {
    await client.fetch(method.trim() as any, params);
  } catch (error) {
    console.error(error);
  }
}
