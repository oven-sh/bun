// Ported from Electron's spec MessageChannelMain coverage
// (spec/api-message-port-spec.ts subset).

import { describe, expect, test } from "bun:test";
import { MessageChannelMain, MessagePortMain } from "../src/index.ts";

describe("MessageChannelMain", () => {
  test("exposes two entangled ports", () => {
    const { port1, port2 } = new MessageChannelMain();
    expect(port1).toBeInstanceOf(MessagePortMain);
    expect(port2).toBeInstanceOf(MessagePortMain);
    expect(port1).not.toBe(port2);
  });

  test("postMessage on one port delivers to the other", async () => {
    const { port1, port2 } = new MessageChannelMain();
    const received = new Promise<unknown>((resolve) => {
      port2.on("message", (event) => resolve(event.data));
    });
    port2.start();
    port1.postMessage({ hello: "world" });
    expect(await received).toEqual({ hello: "world" });
  });

  test("messages are buffered until start() is called", async () => {
    const { port1, port2 } = new MessageChannelMain();
    port1.postMessage("early");
    const received = new Promise<unknown>((resolve) => {
      port2.on("message", (event) => resolve(event.data));
    });
    // The message was sent before any listener/start; it should still arrive.
    port2.start();
    expect(await received).toBe("early");
  });

  test("is bidirectional", async () => {
    const { port1, port2 } = new MessageChannelMain();
    const onP1 = new Promise<unknown>((resolve) => port1.on("message", (e) => resolve(e.data)));
    port1.start();
    port2.start();
    port2.postMessage("from port2");
    expect(await onP1).toBe("from port2");
  });

  test("closed ports stop delivering", async () => {
    const { port1, port2 } = new MessageChannelMain();
    let count = 0;
    port2.on("message", () => count++);
    port2.start();
    port2.close();
    port1.postMessage("ignored");
    await new Promise((r) => setTimeout(r, 20));
    expect(count).toBe(0);
  });

  test("can transfer ports as part of a message", async () => {
    const main = new MessageChannelMain();
    const sub = new MessageChannelMain();
    const gotPort = new Promise<MessagePortMain>((resolve) => {
      main.port2.on("message", (event) => resolve(event.ports[0]));
    });
    main.port2.start();
    main.port1.postMessage("here is a port", [sub.port1]);
    const transferred = await gotPort;
    expect(transferred).toBe(sub.port1);
  });
});
