import type { Server } from "bun";
import { serve } from "bun";
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { WebSocketInspector } from "../../src/inspector/websocket";

let server: Server;
let url: URL;

describe("WebSocketInspector", () => {
  test("fails without a URL", async () => {
    const ws = new WebSocketInspector();
    const fn = mock(error => {
      expect(error).toBeInstanceOf(Error);
    });
    ws.on("Inspector.error", fn);
    await expect(ws.start()).resolves.toBeFalse();
    expect(fn).toHaveBeenCalled();
  });

  test("fails with invalid URL", async () => {
    const ws = new WebSocketInspector("notaurl");
    const fn = mock(error => {
      expect(error).toBeInstanceOf(Error);
    });
    ws.on("Inspector.error", fn);
    await expect(ws.start()).resolves.toBeFalse();
    expect(fn).toHaveBeenCalled();
  });

  test("fails with valid URL but no server", async () => {
    const ws = new WebSocketInspector("ws://localhost:0/doesnotexist/");
    const fn = mock(error => {
      expect(error).toBeInstanceOf(Error);
    });
    ws.on("Inspector.error", fn);
    await expect(ws.start()).resolves.toBeFalse();
    expect(fn).toHaveBeenCalled();
  });

  test("fails with invalid upgrade response", async () => {
    const ws = new WebSocketInspector(new URL("/", url));
    const fn = mock(error => {
      expect(error).toBeInstanceOf(Error);
    });
    ws.on("Inspector.error", fn);
    await expect(ws.start()).resolves.toBeFalse();
    expect(fn).toHaveBeenCalled();
  });

  test("can connect to a server", async () => {
    const ws = new WebSocketInspector(url);
    const fn = mock(() => {
      expect(ws.closed).toBe(false);
    });
    ws.on("Inspector.connected", fn);
    await expect(ws.start()).resolves.toBeTrue();
    expect(fn).toHaveBeenCalled();
    ws.close();
  });

  test("can disconnect from a server", async () => {
    const ws = new WebSocketInspector(url);
    const fn = mock(() => {
      expect(ws.closed).toBeTrue();
    });
    ws.on("Inspector.disconnected", fn);
    await expect(ws.start()).resolves.toBeTrue();
    ws.close();
    expect(fn).toHaveBeenCalled();
  });

  test("can connect to a server multiple times", async () => {
    const ws = new WebSocketInspector(url);
    const fn0 = mock(() => {
      expect(ws.closed).toBeFalse();
    });
    ws.on("Inspector.connected", fn0);
    const fn1 = mock(() => {
      expect(ws.closed).toBeTrue();
    });
    ws.on("Inspector.disconnected", fn1);
    for (let i = 0; i < 3; i++) {
      await expect(ws.start()).resolves.toBeTrue();
      ws.close();
    }
    expect(fn0).toHaveBeenCalledTimes(3);
    expect(fn1).toHaveBeenCalledTimes(3);
  });

  test("can send a request", async () => {
    const ws = new WebSocketInspector(url);
    const fn0 = mock(request => {
      expect(request).toStrictEqual({
        id: 1,
        method: "Debugger.setPauseOnAssertions",
        params: {
          enabled: true,
        },
      });
    });
    ws.on("Inspector.request", fn0);
    const fn1 = mock(response => {
      expect(response).toStrictEqual({
        id: 1,
        result: {
          ok: true,
        },
      });
    });
    ws.on("Inspector.response", fn1);
    await expect(ws.start()).resolves.toBeTrue();
    await expect(ws.send("Debugger.setPauseOnAssertions", { enabled: true })).resolves.toMatchObject({ ok: true });
    expect(fn0).toHaveBeenCalled();
    expect(fn1).toHaveBeenCalled();
    ws.close();
  });

  test("can send a request before connecting", async () => {
    const ws = new WebSocketInspector(url);
    const fn0 = mock(request => {
      expect(request).toStrictEqual({
        id: 1,
        method: "Runtime.enable",
        params: {},
      });
    });
    ws.on("Inspector.pendingRequest", fn0);
    ws.on("Inspector.request", fn0);
    const fn1 = mock(response => {
      expect(response).toStrictEqual({
        id: 1,
        result: {
          ok: true,
        },
      });
    });
    ws.on("Inspector.response", fn1);
    const request = ws.send("Runtime.enable");
    await expect(ws.start()).resolves.toBe(true);
    await expect(request).resolves.toMatchObject({ ok: true });
    expect(fn0).toHaveBeenCalledTimes(2);
    expect(fn1).toHaveBeenCalled();
    ws.close();
  });

  test("can receive an event", async () => {
    const ws = new WebSocketInspector(url);
    const fn = mock(event => {
      expect(event).toStrictEqual({
        method: "Debugger.scriptParsed",
        params: {
          scriptId: "1",
        },
      });
    });
    ws.on("Inspector.event", fn);
    await expect(ws.start()).resolves.toBeTrue();
    await expect(ws.send("Debugger.enable")).resolves.toMatchObject({ ok: true });
    expect(fn).toHaveBeenCalled();
    ws.close();
  });
});

beforeAll(() => {
  server = serve({
    port: 0,
    fetch(request, server) {
      if (request.url.endsWith("/ws") && server.upgrade(request)) {
        return;
      }
      return new Response();
    },
    websocket: {
      message(ws, message) {
        const { id, method } = JSON.parse(String(message));
        ws.send(JSON.stringify({ id, result: { ok: true } }));

        if (method === "Debugger.enable") {
          ws.send(JSON.stringify({ method: "Debugger.scriptParsed", params: { scriptId: "1" } }));
        }
      },
    },
  });
  const { hostname, port } = server;
  url = new URL(`ws://${hostname}:${port}/ws`);
});

afterAll(() => {
  server?.stop(true);
});
