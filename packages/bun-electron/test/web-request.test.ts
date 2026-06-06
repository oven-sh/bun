// Ported from Electron's spec/api-web-request-spec.ts (onBeforeRequest
// subset), exercised against a local Bun server.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { session } from "../src/index.ts";
import { createWindow, ensureReady } from "./harness.ts";

let server: ReturnType<typeof Bun.serve>;
let base: string;

beforeAll(async () => {
  await ensureReady();
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/blocked.js") return new Response("window.__loadedBlocked = true;", { headers: { "content-type": "text/javascript" } });
      if (url.pathname === "/allowed.js") return new Response("window.__loadedAllowed = true;", { headers: { "content-type": "text/javascript" } });
      if (url.pathname === "/subresources") {
        // Same-origin page so the http subresources are allowed to load
        // (a data: page can't load http scripts).
        return new Response(
          `<!doctype html><title>wr</title><body><script src="/blocked.js"></script><script src="/allowed.js"></script></body>`,
          { headers: { "content-type": "text/html" } },
        );
      }
      return new Response(`<!doctype html><title>wr</title><body>web-request</body>`, {
        headers: { "content-type": "text/html" },
      });
    },
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => server.stop(true));

afterEach(() => {
  const wr = session.defaultSession.webRequest;
  wr.onBeforeRequest(null);
  wr.onHeadersReceived(null);
  wr.onCompleted(null);
  wr.onErrorOccurred(null);
});

describe("session.webRequest.onBeforeRequest", () => {
  test("observes requests with url and method", async () => {
    const seen: string[] = [];
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      seen.push(details.url);
      callback({});
    });
    const w = createWindow();
    await w.loadURL(`${base}/`);
    expect(seen.some((u) => u === `${base}/`)).toBe(true);
  });

  test("can cancel a request", async () => {
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: details.url.endsWith("/blocked.js") });
    });
    const w = createWindow();
    await w.loadURL(`${base}/subresources`);
    // Give the subresource loads a moment to settle.
    await new Promise((r) => setTimeout(r, 200));
    expect(await w.webContents.executeJavaScript("window.__loadedAllowed === true")).toBe(true);
    expect(await w.webContents.executeJavaScript("typeof window.__loadedBlocked")).toBe("undefined");
  });

  test("respects a URL filter", async () => {
    let sawAllowed = false;
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ["*://*/blocked.js"] },
      (details, callback) => {
        if (details.url.endsWith("/allowed.js")) sawAllowed = true;
        callback({});
      },
    );
    const w = createWindow();
    await w.loadURL(`${base}/subresources`);
    await new Promise((r) => setTimeout(r, 200));
    // The filter only matches blocked.js, so the listener never saw allowed.js.
    expect(sawAllowed).toBe(false);
  });

  test("onCompleted fires with a status code", async () => {
    const statuses: number[] = [];
    session.defaultSession.webRequest.onCompleted((details) => {
      if (String(details.url).endsWith("/")) statuses.push(details.statusCode as number);
    });
    const w = createWindow();
    await w.loadURL(`${base}/`);
    await new Promise((r) => setTimeout(r, 150));
    expect(statuses.some((s) => s === 200)).toBe(true);
    session.defaultSession.webRequest.onCompleted(null);
  });

  test("onHeadersReceived sees response headers", async () => {
    let headers: Record<string, string> | null = null;
    session.defaultSession.webRequest.onHeadersReceived((details) => {
      if (String(details.url).endsWith("/")) headers = details.responseHeaders as Record<string, string>;
    });
    const w = createWindow();
    await w.loadURL(`${base}/`);
    await new Promise((r) => setTimeout(r, 150));
    expect(headers).not.toBeNull();
    session.defaultSession.webRequest.onHeadersReceived(null);
  });

  test("onErrorOccurred fires for a failed load", async () => {
    const free = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const deadPort = free.port;
    free.stop(true);
    let errored = false;
    session.defaultSession.webRequest.onErrorOccurred(() => {
      errored = true;
    });
    const w = createWindow();
    await w.loadURL(`http://127.0.0.1:${deadPort}/`).catch(() => {});
    await new Promise((r) => setTimeout(r, 200));
    expect(errored).toBe(true);
    session.defaultSession.webRequest.onErrorOccurred(null);
  });

  test("onBeforeRequest(null) removes the listener", () => {
    session.defaultSession.webRequest.onBeforeRequest((_d, cb) => cb({}));
    expect(session.defaultSession.webRequest.hasListener()).toBe(true);
    session.defaultSession.webRequest.onBeforeRequest(null);
    expect(session.defaultSession.webRequest.hasListener()).toBe(false);
  });
});
