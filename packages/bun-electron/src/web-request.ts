// session.webRequest — Electron-compatible request interception (the
// onBeforeRequest subset, backed by CEF's resource-request handler in the
// shim). A listener may cancel a request or redirect it.

import * as native from "./native";

export interface OnBeforeRequestDetails {
  id: number;
  url: string;
  method: string;
  resourceType: string;
  webContentsId: number;
}

export interface OnBeforeRequestResponse {
  cancel?: boolean;
  redirectURL?: string;
}

export interface WebRequestFilter {
  urls: string[];
}

type Listener = (
  details: OnBeforeRequestDetails,
  callback: (response: OnBeforeRequestResponse) => void,
) => void;

// Glob-ish match for Chrome match patterns ("*://*.example.com/*").
function matchesFilter(url: string, filter: WebRequestFilter | null): boolean {
  if (!filter || !Array.isArray(filter.urls) || filter.urls.length === 0) return true;
  return filter.urls.some((pattern) => {
    if (pattern === "<all_urls>") return true;
    const re = new RegExp(
      "^" +
        pattern
          .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*") +
        "$",
    );
    return re.test(url);
  });
}

class WebRequest {
  private beforeRequest: { filter: WebRequestFilter | null; listener: Listener } | null = null;

  onBeforeRequest(
    filterOrListener: WebRequestFilter | Listener | null,
    maybeListener?: Listener,
  ): void {
    if (filterOrListener === null) {
      this.beforeRequest = null;
      native.webRequestSetActive(false);
      return;
    }
    let filter: WebRequestFilter | null;
    let listener: Listener;
    if (typeof filterOrListener === "function") {
      filter = null;
      listener = filterOrListener;
    } else {
      filter = filterOrListener;
      listener = maybeListener!;
    }
    this.beforeRequest = { filter, listener };
    native.webRequestSetActive(true);
  }

  /** @internal Routes a native web-request-before event. */
  _handle(ev: Record<string, unknown>): void {
    const id = ev.requestId as number;
    const entry = this.beforeRequest;
    const details: OnBeforeRequestDetails = {
      id,
      url: String(ev.url),
      method: String(ev.method),
      resourceType: String(ev.resourceType),
      webContentsId: (ev.windowId as number) ?? 0,
    };
    if (!entry || !matchesFilter(details.url, entry.filter)) {
      native.webRequestContinue(id, false);
      return;
    }
    let settled = false;
    const callback = (response: OnBeforeRequestResponse) => {
      if (settled) return;
      settled = true;
      native.webRequestContinue(id, Boolean(response?.cancel));
    };
    try {
      entry.listener(details, callback);
    } catch {
      if (!settled) {
        settled = true;
        native.webRequestContinue(id, false);
      }
    }
  }

  hasListener(): boolean {
    return this.beforeRequest !== null;
  }
}

const defaultWebRequest = new WebRequest();

export function defaultSessionWebRequest(): WebRequest {
  return defaultWebRequest;
}

export function routeWebRequestEvent(ev: Record<string, unknown>): void {
  defaultWebRequest._handle(ev);
}

export { WebRequest };
