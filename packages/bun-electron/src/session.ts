// session — cookie access backed by CEF's global CefCookieManager.

import * as native from "./native";

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

export function routeCookiesEvent(ev: { opId?: unknown; success?: unknown; cookies?: unknown }): void {
  const pending = pendingOps.get(ev.opId as number);
  if (!pending) return;
  pendingOps.delete(ev.opId as number);
  if (!ev.success) {
    pending.reject(new Error("cookie operation failed"));
    return;
  }
  pending.resolve(Array.isArray(ev.cookies) ? (ev.cookies as Cookie[]) : []);
}

function runOp(op: string, kv: Record<string, string | number | boolean | undefined>): Promise<Cookie[]> {
  const opId = nextOpId++;
  return new Promise((resolve, reject) => {
    pendingOps.set(opId, { resolve, reject });
    native.cookiesOp(opId, op, kv);
  });
}

class Cookies {
  async get(filter: CookiesGetFilter = {}): Promise<Cookie[]> {
    let cookies = await runOp("get", { url: filter.url });
    if (filter.name !== undefined) cookies = cookies.filter((c) => c.name === filter.name);
    if (filter.domain !== undefined) cookies = cookies.filter((c) => c.domain?.endsWith(filter.domain!));
    return cookies;
  }

  async set(details: CookiesSetDetails): Promise<void> {
    if (!details || typeof details.url !== "string") {
      throw new TypeError("url must be specified");
    }
    await runOp("set", {
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
    await runOp("remove", { url, name });
  }
}

class Session {
  readonly cookies = new Cookies();
}

const defaultSession = new Session();

export const session = {
  get defaultSession(): Session {
    return defaultSession;
  },
  fromPartition(_partition: string): Session {
    // Partitioned sessions are not implemented; everything shares the
    // global CEF request context.
    return defaultSession;
  },
};
