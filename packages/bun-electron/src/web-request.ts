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

type ObservationalListener = (details: Record<string, unknown>) => void;

class WebRequest {
  private beforeRequest: { filter: WebRequestFilter | null; listener: Listener } | null = null;
  private headersReceived: { filter: WebRequestFilter | null; listener: ObservationalListener } | null = null;
  private completed: { filter: WebRequestFilter | null; listener: ObservationalListener } | null = null;
  private errorOccurred: { filter: WebRequestFilter | null; listener: ObservationalListener } | null = null;

  private setObservational(
    slot: "headersReceived" | "completed" | "errorOccurred",
    filterOrListener: WebRequestFilter | ObservationalListener | null,
    maybeListener?: ObservationalListener,
  ): void {
    if (filterOrListener === null) {
      this[slot] = null;
      this.syncActive();
      return;
    }
    if (typeof filterOrListener === "function") {
      this[slot] = { filter: null, listener: filterOrListener };
    } else {
      this[slot] = { filter: filterOrListener, listener: maybeListener! };
    }
    this.syncActive();
  }

  private syncActive(): void {
    const active =
      this.beforeRequest !== null ||
      this.headersReceived !== null ||
      this.completed !== null ||
      this.errorOccurred !== null;
    native.webRequestSetActive(active);
  }

  onHeadersReceived(f: WebRequestFilter | ObservationalListener | null, l?: ObservationalListener): void {
    this.setObservational("headersReceived", f, l);
  }

  onCompleted(f: WebRequestFilter | ObservationalListener | null, l?: ObservationalListener): void {
    this.setObservational("completed", f, l);
  }

  onErrorOccurred(f: WebRequestFilter | ObservationalListener | null, l?: ObservationalListener): void {
    this.setObservational("errorOccurred", f, l);
  }

  onBeforeRequest(
    filterOrListener: WebRequestFilter | Listener | null,
    maybeListener?: Listener,
  ): void {
    if (filterOrListener === null) {
      this.beforeRequest = null;
      this.syncActive();
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
    this.syncActive();
  }

  private dispatchObservational(
    entry: { filter: WebRequestFilter | null; listener: ObservationalListener } | null,
    url: string,
    details: Record<string, unknown>,
  ): void {
    if (!entry || !matchesFilter(url, entry.filter)) return;
    try {
      entry.listener(details);
    } catch {
      // listener errors are swallowed (observational stage)
    }
  }

  _handleHeaders(ev: Record<string, unknown>): void {
    this.dispatchObservational(this.headersReceived, String(ev.url), {
      url: String(ev.url),
      statusCode: ev.statusCode as number,
      responseHeaders: ev.headers ?? {},
      webContentsId: (ev.windowId as number) ?? 0,
    });
  }

  _handleCompleted(ev: Record<string, unknown>): void {
    this.dispatchObservational(this.completed, String(ev.url), {
      url: String(ev.url),
      statusCode: ev.statusCode as number,
      webContentsId: (ev.windowId as number) ?? 0,
    });
  }

  _handleError(ev: Record<string, unknown>): void {
    this.dispatchObservational(this.errorOccurred, String(ev.url), {
      url: String(ev.url),
      error: "net::ERR_FAILED",
      webContentsId: (ev.windowId as number) ?? 0,
    });
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
    return (
      this.beforeRequest !== null ||
      this.headersReceived !== null ||
      this.completed !== null ||
      this.errorOccurred !== null
    );
  }
}

const defaultWebRequest = new WebRequest();

export function defaultSessionWebRequest(): WebRequest {
  return defaultWebRequest;
}

export function routeWebRequestEvent(ev: Record<string, unknown>): void {
  switch (ev.type) {
    case "web-request-before":
      defaultWebRequest._handle(ev);
      break;
    case "web-request-headers":
      defaultWebRequest._handleHeaders(ev);
      break;
    case "web-request-completed":
      defaultWebRequest._handleCompleted(ev);
      break;
    case "web-request-error":
      defaultWebRequest._handleError(ev);
      break;
  }
}

export { WebRequest };
