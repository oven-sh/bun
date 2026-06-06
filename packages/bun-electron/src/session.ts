// session — cookie access backed by CEF's global CefCookieManager.

import * as native from "./native";
import { defaultSessionWebRequest, type WebRequest } from "./web-request";

export interface Cookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
}

export interface CookiesSetDetails extends Cookie {
  url: string;
}

export interface CookiesGetFilter {
  url?: string;
  name?: string;
  domain?: string;
}

let nextOpId = 1;
const pendingOps = new Map<number, { resolve: (v: Cookie[]) => void; reject: (e: Error) => void }>();

export function routeCookiesEvent(ev: Record<string, unknown>): void {
  const pending = pendingOps.get(ev.opId as number);
  if (!pending) return;
  pendingOps.delete(ev.opId as number);
  if (!ev.success) {
    pending.reject(new Error("cookie operation failed"));
    return;
  }
  pending.resolve(Array.isArray(ev.cookies) ? (ev.cookies as Cookie[]) : []);
}

function runOp(
  partition: string,
  op: string,
  kv: Record<string, string | number | boolean | undefined>,
): Promise<Cookie[]> {
  const opId = nextOpId++;
  return new Promise((resolve, reject) => {
    pendingOps.set(opId, { resolve, reject });
    native.cookiesOp(opId, op, { ...kv, partition });
  });
}

class Cookies {
  constructor(private readonly partition: string) {}

  async get(filter: CookiesGetFilter = {}): Promise<Cookie[]> {
    let cookies = await runOp(this.partition, "get", { url: filter.url });
    if (filter.name !== undefined) cookies = cookies.filter((c) => c.name === filter.name);
    if (filter.domain !== undefined) cookies = cookies.filter((c) => c.domain?.endsWith(filter.domain!));
    return cookies;
  }

  async set(details: CookiesSetDetails): Promise<void> {
    if (!details || typeof details.url !== "string") {
      throw new TypeError("url must be specified");
    }
    await runOp(this.partition, "set", {
      url: details.url,
      name: details.name,
      value: details.value,
      domain: details.domain,
      path: details.path,
      secure: details.secure,
      httpOnly: details.httpOnly,
    });
  }

  async remove(url: string, name: string): Promise<void> {
    await runOp(this.partition, "remove", { url, name });
  }
}

class Session {
  readonly cookies: Cookies;
  readonly webRequest: WebRequest;

  constructor(readonly partition: string) {
    this.cookies = new Cookies(partition);
    // webRequest interception is wired at the browser level (one native
    // hook), so all sessions share the default webRequest instance.
    this.webRequest = defaultSessionWebRequest();
  }
}

const defaultSession = new Session("");
const partitioned = new Map<string, Session>();

export const session = {
  get defaultSession(): Session {
    return defaultSession;
  },
  fromPartition(partition: string): Session {
    if (!partition) return defaultSession;
    let s = partitioned.get(partition);
    if (!s) {
      s = new Session(partition);
      partitioned.set(partition, s);
    }
    return s;
  },
};

export { Session };
