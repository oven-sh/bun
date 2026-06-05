// protocol — custom URL scheme handling, backed by a CEF scheme handler
// factory in the shim. Schemes must be registered before the app starts
// (protocol.registerSchemesAsPrivileged), matching Electron's requirement.

import * as native from "./native";

export interface ProtocolRequest {
  url: string;
  method: string;
  /** POST body, when present. */
  body?: Uint8Array;
}

export type ProtocolHandler = (
  request: ProtocolRequest,
) => Response | { statusCode?: number; mimeType?: string; data: string | Uint8Array } | Promise<
  Response | { statusCode?: number; mimeType?: string; data: string | Uint8Array }
>;

const registeredSchemes: string[] = [];
const handlers = new Map<string, ProtocolHandler>();
let appStarted = false;

export function customSchemes(): string[] {
  appStarted = true;
  return registeredSchemes;
}

export async function routeProtocolEvent(ev: Record<string, unknown>): Promise<void> {
  const resourceId = ev.resourceId as number;
  const scheme = String(ev.scheme);
  const handler = handlers.get(scheme);
  if (!handler) {
    native.resourceReply(resourceId, 404, "text/plain", Buffer.from("no handler registered").toString("base64"));
    return;
  }
  try {
    const request: ProtocolRequest = {
      url: String(ev.url),
      method: String(ev.method),
      body: ev.body ? new Uint8Array(Buffer.from(String(ev.body), "base64")) : undefined,
    };
    const result = await handler(request);
    let status = 200;
    let mime = "text/html";
    let body: Buffer;
    if (result instanceof Response) {
      status = result.status;
      mime = result.headers.get("content-type")?.split(";")[0] ?? "text/html";
      body = Buffer.from(await result.arrayBuffer());
    } else {
      status = result.statusCode ?? 200;
      mime = result.mimeType ?? "text/html";
      body = typeof result.data === "string" ? Buffer.from(result.data) : Buffer.from(result.data);
    }
    native.resourceReply(resourceId, status, mime, body.toString("base64"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    native.resourceReply(resourceId, 500, "text/plain", Buffer.from(message).toString("base64"));
  }
}

export const protocol = {
  /** Must be called before the app is ready (CEF registers schemes at startup). */
  registerSchemesAsPrivileged(customSchemes: Array<{ scheme: string; privileges?: Record<string, boolean> }>): void {
    if (appStarted) {
      throw new Error("protocol.registerSchemesAsPrivileged should be called before app is ready");
    }
    if (!Array.isArray(customSchemes)) {
      throw new TypeError("customSchemes must be an array");
    }
    for (const { scheme } of customSchemes) {
      if (typeof scheme !== "string" || !/^[a-z][a-z0-9+.-]*$/.test(scheme)) {
        throw new TypeError(`Invalid scheme name '${scheme}'`);
      }
      if (!registeredSchemes.includes(scheme)) registeredSchemes.push(scheme);
    }
  },

  handle(scheme: string, handler: ProtocolHandler): void {
    if (handlers.has(scheme)) {
      throw new Error(`protocol.handle: '${scheme}' is already handled`);
    }
    handlers.set(scheme, handler);
  },

  unhandle(scheme: string): void {
    handlers.delete(scheme);
  },

  isProtocolHandled(scheme: string): boolean {
    return handlers.has(scheme);
  },
};
