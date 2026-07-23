import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { connect } from "node:net";
import { networkInterfaces } from "node:os";
import { getRandomId, WebSocketDebugAdapter } from "./adapter.js";
import { TCPSocketSignal } from "./signal.js";
import { SourceMap } from "./sourcemap.js";

test("works without source map", () => {
  const sourceMap = getSourceMap("without-sourcemap.js");
  expect(sourceMap.generatedLocation({ line: 7 })).toEqual({ line: 7, column: 0, verified: true });
  expect(sourceMap.generatedLocation({ line: 7, column: 2 })).toEqual({ line: 7, column: 2, verified: true });
  expect(sourceMap.originalLocation({ line: 11 })).toEqual({ line: 11, column: 0, verified: true });
  expect(sourceMap.originalLocation({ line: 11, column: 2 })).toEqual({ line: 11, column: 2, verified: true });
});

test("works with source map", () => {
  const sourceMap = getSourceMap("with-sourcemap.js");
  // FIXME: Columns don't appear to be accurate for `generatedLocation`
  expect(sourceMap.generatedLocation({ line: 3 })).toMatchObject({ line: 4, verified: true });
  expect(sourceMap.generatedLocation({ line: 27 })).toMatchObject({ line: 20, verified: true });
  expect(sourceMap.originalLocation({ line: 32 })).toEqual({ line: 43, column: 4, verified: true });
  expect(sourceMap.originalLocation({ line: 13 })).toEqual({ line: 13, column: 6, verified: true });
});

function getSourceMap(filename: string): SourceMap {
  const { pathname } = new URL(`./fixtures/${filename}`, import.meta.url);
  const source = readFileSync(pathname, "utf-8");
  const match = source.match(/\/\/# sourceMappingURL=(.*)$/m);
  if (match) {
    const [, url] = match;
    return SourceMap(url);
  }
  return SourceMap();
}

test("only forwards inspector events from known protocol domains to the adapter", () => {
  const adapter = new WebSocketDebugAdapter();

  // Replace the launch request handler so a (wrongly) forwarded event is observable
  // without spawning any process.
  const launchCalls: unknown[][] = [];
  (adapter as any).launch = (...args: unknown[]) => {
    launchCalls.push(args);
  };

  const inspector = adapter.getInspector();

  // The WebSocket inspector re-emits any message without an "id" using the method name
  // chosen by the remote peer. An event named after a DAP request must not be forwarded
  // to the adapter, where it would be dispatched to the matching request handler.
  (inspector as any).emit("launch", {
    runtime: "/bin/sh",
    runtimeArgs: ["-c", "echo unexpected"],
    program: "example.js",
  });
  expect(launchCalls).toHaveLength(0);

  // A genuine inspector-domain event still reaches listeners registered on the adapter.
  const heapEvents: unknown[] = [];
  adapter.on("Heap.garbageCollected", event => {
    heapEvents.push(event);
  });
  (inspector as any).emit("Heap.garbageCollected", {
    collection: { type: "full", startTime: 0, endTime: 1 },
  });
  expect(heapEvents).toEqual([{ collection: { type: "full", startTime: 0, endTime: 1 } }]);
});

test("getRandomId returns a distinct 32-character lowercase hex string on every call", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 256; i++) {
    const id = getRandomId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    ids.add(id);
  }
  expect(ids.size).toBe(256);
});

test("TCPSocketSignal accepts connections only on the loopback interface", async () => {
  // Same construction the VS Code extension uses (diagnostics.ts createSignal).
  const signal = new TCPSocketSignal(0);
  await signal.ready;
  const port = signal.port;

  try {
    // The legitimate local client connects over loopback and its payload is delivered.
    const received = new Promise<string>(resolve => signal.once("Signal.received", resolve));
    await new Promise<void>((resolve, reject) => {
      const client = connect({ host: "127.0.0.1", port }, () => {
        client.end("hello");
        resolve();
      });
      client.on("error", reject);
    });
    expect(await received).toBe("hello");

    // The same port is not reachable through a non-loopback interface address.
    let external: string | undefined;
    for (const addresses of Object.values(networkInterfaces())) {
      for (const { family, internal, address } of addresses ?? []) {
        if (family === "IPv4" && !internal) {
          external = address;
          break;
        }
      }
      if (external) break;
    }

    if (external) {
      const externalHost = external;
      const connectError = await new Promise<Error | null>(resolve => {
        const client = connect({ host: externalHost, port }, () => {
          client.end();
          resolve(null);
        });
        client.on("error", error => resolve(error));
      });
      expect(connectError).not.toBeNull();
    }
  } finally {
    signal.close();
  }
});
