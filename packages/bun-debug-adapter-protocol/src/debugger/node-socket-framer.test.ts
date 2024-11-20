import { beforeEach, describe, expect, it, jest } from "bun:test";
import { EventEmitter } from "node:events";
import { Socket } from "node:net";
import { SocketFramer } from "./node-socket-framer.ts";

class MockSocket extends EventEmitter {
  written: Buffer[] = [];

  write(data: Buffer | string): boolean {
    this.written.push(Buffer.from(data));
    return true;
  }
}

describe("SocketFramer", () => {
  let mockSocket: Socket & { written: Buffer[] };
  let onMessageMock: jest.Mock;
  let framer: SocketFramer;

  beforeEach(() => {
    mockSocket = new MockSocket() as never;
    onMessageMock = jest.fn();
    framer = new SocketFramer(mockSocket, onMessageMock);
  });

  describe("send", () => {
    it("should properly frame a message with length prefix", () => {
      const message = "Hello, World!";
      framer.send(message);

      expect(mockSocket.written).toHaveLength(2);

      // First chunk should be length (13) as 32-bit BE integer
      expect(mockSocket.written[0]).toEqual(Buffer.from([0, 0, 0, 13]));

      // Second chunk should be the message
      expect(mockSocket.written[1].toString()).toBe(message);
    });

    it("should handle empty messages", () => {
      const message = "";
      framer.send(message);

      expect(mockSocket.written).toHaveLength(2);
      expect(mockSocket.written[0]).toEqual(Buffer.from([0, 0, 0, 0]));
      expect(mockSocket.written[1].toString()).toBe("");
    });

    it("should handle unicode characters", () => {
      const message = "Hello 👋 World 🌍";
      framer.send(message);

      expect(mockSocket.written).toHaveLength(2);
      expect(mockSocket.written[1].toString()).toBe(message);
    });
  });

  describe("onData", () => {
    it("should handle a single complete message", () => {
      const message = "Hello, World!";
      const lengthBuffer = Buffer.alloc(4);
      lengthBuffer.writeUInt32BE(message.length);

      framer.onData(Buffer.concat([lengthBuffer, Buffer.from(message)]));

      expect(onMessageMock).toHaveBeenCalledTimes(1);
      expect(onMessageMock).toHaveBeenCalledWith(message);
    });

    it("should handle multiple complete messages in one chunk", () => {
      const messages = ["First", "Second", "Third"];
      const buffer = Buffer.concat(
        messages.map(msg => {
          const lengthBuffer = Buffer.alloc(4);
          lengthBuffer.writeUInt32BE(msg.length);
          return Buffer.concat([lengthBuffer, Buffer.from(msg)]);
        }),
      );

      framer.onData(buffer);

      expect(onMessageMock).toHaveBeenCalledTimes(1);
      expect(onMessageMock).toHaveBeenCalledWith(messages);
    });

    it("should handle fragmented length", () => {
      const message = "Hello";
      const lengthBuffer = Buffer.alloc(4);
      lengthBuffer.writeUInt32BE(message.length);

      // Send length buffer in two parts
      framer.onData(lengthBuffer.slice(0, 2));
      framer.onData(Buffer.concat([lengthBuffer.slice(2), Buffer.from(message)]));

      expect(onMessageMock).toHaveBeenCalledTimes(1);
      expect(onMessageMock).toHaveBeenCalledWith(message);
    });

    it("should handle fragmented message", () => {
      const message = "Hello, World!";
      const lengthBuffer = Buffer.alloc(4);
      lengthBuffer.writeUInt32BE(message.length);

      framer.onData(Buffer.concat([lengthBuffer, Buffer.from(message.slice(0, 5))]));
      framer.onData(Buffer.from(message.slice(5)));

      expect(onMessageMock).toHaveBeenCalledTimes(1);
      expect(onMessageMock).toHaveBeenCalledWith(message);
    });

    it("should handle messages with zero length", () => {
      const lengthBuffer = Buffer.alloc(4);
      lengthBuffer.writeUInt32BE(0);

      framer.onData(lengthBuffer);

      expect(onMessageMock).toHaveBeenCalledTimes(1);
      expect(onMessageMock).toHaveBeenCalledWith("");
    });

    it("should handle large messages", () => {
      const message = "x".repeat(100000);
      const lengthBuffer = Buffer.alloc(4);
      lengthBuffer.writeUInt32BE(message.length);

      framer.onData(Buffer.concat([lengthBuffer, Buffer.from(message)]));

      expect(onMessageMock).toHaveBeenCalledTimes(1);
      expect(onMessageMock).toHaveBeenCalledWith(message);
    });

    it("should handle multiple fragmented messages with varying sizes", () => {
      const messages = [
        "First message",
        "x".repeat(1000), // Medium size message
        "👋".repeat(100), // Unicode characters
        "Short",
        "x".repeat(10000), // Large message
      ];

      const buffers = messages.map(msg => {
        const lengthBuffer = Buffer.alloc(4);
        lengthBuffer.writeUInt32BE(msg.length);
        return Buffer.concat([lengthBuffer, Buffer.from(msg)]);
      });

      const fullBuffer = Buffer.concat(buffers);

      // Send data in random chunks
      const chunks = [
        fullBuffer.slice(0, 100),
        fullBuffer.slice(100, 500),
        fullBuffer.slice(500, 2000),
        fullBuffer.slice(2000, 5000),
        fullBuffer.slice(5000),
      ];

      chunks.forEach(chunk => {
        framer.onData(chunk);
      });

      expect(onMessageMock).toHaveBeenCalledTimes(1);
      expect(onMessageMock).toHaveBeenCalledWith(messages);
    });

    it("should handle interleaved length and message fragments", () => {
      const message1 = "First message";
      const message2 = "Second message";

      const length1 = Buffer.alloc(4);
      const length2 = Buffer.alloc(4);
      length1.writeUInt32BE(message1.length);
      length2.writeUInt32BE(message2.length);

      // Send fragments in this order:
      // 1. Half of first length
      // 2. Half of second length
      // 3. Rest of first length + part of first message
      // 4. Rest of second length + part of second message
      // 5. Rest of first message
      // 6. Rest of second message

      framer.onData(length1.slice(0, 2));
      framer.onData(length2.slice(0, 2));
      framer.onData(Buffer.concat([length1.slice(2), Buffer.from(message1.slice(0, 5))]));
      framer.onData(Buffer.concat([length2.slice(2), Buffer.from(message2.slice(0, 5))]));
      framer.onData(Buffer.from(message1.slice(5)));
      framer.onData(Buffer.from(message2.slice(5)));

      expect(onMessageMock).toHaveBeenCalledTimes(1);
      expect(onMessageMock).toHaveBeenCalledWith([message1, message2]);
    });

    it("should handle very large fragmented messages", () => {
      const message1 = "x".repeat(100000);
      const message2 = "y".repeat(200000);
      const message3 = "z".repeat(50000);

      const messages = [message1, message2, message3];
      const buffers = messages.map(msg => {
        const lengthBuffer = Buffer.alloc(4);
        lengthBuffer.writeUInt32BE(msg.length);
        return Buffer.concat([lengthBuffer, Buffer.from(msg)]);
      });

      const fullBuffer = Buffer.concat(buffers);

      // Split into ~50KB chunks
      const chunkSize = 50000;
      const chunks = [];
      for (let i = 0; i < fullBuffer.length; i += chunkSize) {
        chunks.push(fullBuffer.slice(i, i + chunkSize));
      }

      // Send chunks with random delays to simulate network conditions
      chunks.forEach(chunk => {
        framer.onData(chunk);
      });

      expect(onMessageMock).toHaveBeenCalledTimes(3);
      expect(onMessageMock).toHaveBeenCalledWith(messages);
    });
  });
});
