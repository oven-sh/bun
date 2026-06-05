// Ported from Electron's spec/api-protocol-spec.ts (protocol.handle subset).
// The "bunapp" scheme is registered as privileged in harness.ts, before the
// app starts.

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { protocol } from "../src/index.ts";
import { createWindow, ensureReady } from "./harness.ts";

beforeAll(async () => {
  await ensureReady();
});

afterEach(() => {
  protocol.unhandle("bunapp");
});

describe("protocol module", () => {
  test("registerSchemesAsPrivileged throws after the app is ready", () => {
    expect(() => protocol.registerSchemesAsPrivileged([{ scheme: "toolate" }])).toThrow(
      /before app is ready/,
    );
  });

  describe("protocol.handle", () => {
    test("serves a response for the registered scheme", async () => {
      protocol.handle("bunapp", () => ({
        mimeType: "text/html",
        data: "<title>from-protocol</title><h1 id='h'>hello protocol</h1>",
      }));
      const w = createWindow();
      await w.loadURL("bunapp://host/index.html");
      expect(await w.webContents.executeJavaScript("document.title")).toBe("from-protocol");
      expect(await w.webContents.executeJavaScript("document.getElementById('h').textContent")).toBe(
        "hello protocol",
      );
    });

    test("receives the request URL and method", async () => {
      let seen: { url: string; method: string } | null = null;
      protocol.handle("bunapp", (request) => {
        seen = { url: request.url, method: request.method };
        return { data: "<body>ok</body>" };
      });
      const w = createWindow();
      await w.loadURL("bunapp://host/some/path?q=1");
      expect(seen!.url).toBe("bunapp://host/some/path?q=1");
      expect(seen!.method).toBe("GET");
    });

    test("supports Response objects and fetch() from the page", async () => {
      protocol.handle("bunapp", (request) => {
        if (request.url.endsWith("/data.json")) {
          return new Response(JSON.stringify({ from: "main" }), {
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("<body>page</body>", { headers: { "content-type": "text/html" } });
      });
      const w = createWindow();
      await w.loadURL("bunapp://host/");
      const result = await w.webContents.executeJavaScript(
        `fetch("bunapp://host/data.json").then((r) => r.json())`,
      );
      expect(result).toEqual({ from: "main" });
    });

    test("handler errors produce a failed load", async () => {
      protocol.handle("bunapp", () => {
        throw new Error("handler exploded");
      });
      const w = createWindow();
      // A 500 response still renders (no load failure), but the body carries
      // the error message.
      await w.loadURL("bunapp://host/boom");
      const body = await w.webContents.executeJavaScript("document.body.textContent");
      expect(body).toContain("handler exploded");
    });

    test("throws when a scheme is handled twice", () => {
      protocol.handle("bunapp", () => ({ data: "x" }));
      expect(() => protocol.handle("bunapp", () => ({ data: "y" }))).toThrow(/already handled/);
    });

    test("isProtocolHandled reflects registration", () => {
      expect(protocol.isProtocolHandled("bunapp")).toBe(false);
      protocol.handle("bunapp", () => ({ data: "x" }));
      expect(protocol.isProtocolHandled("bunapp")).toBe(true);
      protocol.unhandle("bunapp");
      expect(protocol.isProtocolHandled("bunapp")).toBe(false);
    });
  });
});
