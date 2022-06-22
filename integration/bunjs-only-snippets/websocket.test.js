import { describe, it, expect } from "bun:test";
import { unsafe } from "bun";

const TEST_WEBSOCKET_HOST =
  process.env.TEST_WEBSOCKET_HOST || "wss://ws.postman-echo.com/raw";

describe("WebSocket", () => {
  it("should connect", async () => {
    const ws = new WebSocket(TEST_WEBSOCKET_HOST);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    ws.close();
  });

  it("should send and receive messages", async () => {
    const ws = new WebSocket(TEST_WEBSOCKET_HOST);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
      ws.onclose = () => {
        expect(ws.bufferedAmount).toBe(0);
        resolve();
      };
    });
    var promise = new Promise((resolve, reject) => {
      ws.onmessage = (event) => {
        expect(event.data).toBe("Hello World!");
        ws.close();
        resolve();
      };
      ws.onerror = reject;
    });
    ws.send("Hello World");

    await promise;
  });
});
