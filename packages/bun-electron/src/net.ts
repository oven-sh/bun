// net — Electron-compatible HTTP client.
//
// Electron's net runs on Chromium's network stack; here it is backed by the
// runtime's global fetch, which is sufficient for the documented API:
// net.fetch (WHATWG fetch) and net.request (a Node http.ClientRequest-shaped
// wrapper that emits a 'response' event).

import { EventEmitter } from "node:events";

export interface ClientRequestConstructorOptions {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
}

class IncomingMessage extends EventEmitter {
  constructor(
    readonly statusCode: number,
    readonly statusMessage: string,
    readonly headers: Record<string, string>,
  ) {
    super();
  }
}

export class ClientRequest extends EventEmitter {
  private readonly method: string;
  private readonly url: string;
  private readonly headers: Record<string, string> = {};
  private readonly chunks: Uint8Array[] = [];
  private aborted = false;

  constructor(options: ClientRequestConstructorOptions | string) {
    super();
    if (typeof options === "string") {
      this.method = "GET";
      this.url = options;
    } else {
      this.method = (options.method ?? "GET").toUpperCase();
      this.url = options.url ?? "";
      for (const [k, v] of Object.entries(options.headers ?? {})) this.headers[k] = v;
    }
  }

  setHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  getHeader(name: string): string | undefined {
    return this.headers[name];
  }

  removeHeader(name: string): void {
    delete this.headers[name];
  }

  write(chunk: string | Uint8Array): void {
    this.chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  abort(): void {
    this.aborted = true;
    this.emit("abort");
  }

  end(chunk?: string | Uint8Array): void {
    if (chunk !== undefined) this.write(chunk);
    const body = this.method === "GET" || this.method === "HEAD" ? undefined : Buffer.concat(this.chunks.map((c) => Buffer.from(c)));

    fetch(this.url, { method: this.method, headers: this.headers, body })
      .then(async (res) => {
        if (this.aborted) return;
        const headers: Record<string, string> = {};
        res.headers.forEach((value, key) => (headers[key] = value));
        const message = new IncomingMessage(res.status, res.statusText, headers);
        this.emit("response", message);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length) message.emit("data", buf);
        message.emit("end");
      })
      .catch((err) => {
        if (!this.aborted) this.emit("error", err instanceof Error ? err : new Error(String(err)));
      });
  }
}

export const net = {
  request(options: ClientRequestConstructorOptions | string): ClientRequest {
    return new ClientRequest(options);
  },

  fetch(input: string | Request, init?: RequestInit): Promise<Response> {
    return fetch(input as never, init);
  },

  isOnline(): boolean {
    return true;
  },
};
