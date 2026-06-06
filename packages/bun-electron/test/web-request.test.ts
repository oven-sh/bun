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
  session.defaultSession.webRequest.onBeforeRequest(null);
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

  test("onBeforeRequest(null) removes the listener", () => {
    session.defaultSession.webRequest.onBeforeRequest((_d, cb) => cb({}));
    expect(session.defaultSession.webRequest.hasListener()).toBe(true);
    session.defaultSession.webRequest.onBeforeRequest(null);
    expect(session.defaultSession.webRequest.hasListener()).toBe(false);
  });
});
