import { Socket, createConnection } from "node:net";
import { inspect } from "node:util";
import type { JSC } from "../types/jsc";
export type { JSC };

export type JSCClientOptions = {
  url: string | URL;
  retry?: boolean;
  onEvent?: (event: JSC.Event) => void;
  onRequest?: (request: JSC.Request) => void;
  onResponse?: (response: JSC.Response) => void;
  onError?: (error: Error) => void;
  onClose?: (code: number, reason: string) => void;
};
const headerInvalidNumber = 2147483646;

// We use non-printable characters to separate messages in the stream.
// These should never appear in textual messages.

// These are non-sequential so that code which just counts up from 0 doesn't accidentally parse them as messages.
// 0x12 0x11 0x13 0x14 as a little-endian 32-bit unsigned integer
const headerPrefix = "\x14\x13\x11\x12";

// 0x14 0x12 0x13 0x11 as a little-endian 32-bit unsigned integer
const headerSuffixString = "\x11\x13\x12\x14";

const headerSuffixInt = Buffer.from(headerSuffixString).readInt32LE(0);
const headerPrefixInt = Buffer.from(headerPrefix).readInt32LE(0);

const messageLengthBuffer = new ArrayBuffer(12);
const messageLengthDataView = new DataView(messageLengthBuffer);
messageLengthDataView.setInt32(0, headerPrefixInt, true);
messageLengthDataView.setInt32(8, headerSuffixInt, true);

function writeJSONMessageToBuffer(message: any) {
  const asString = JSON.stringify(message);
  const byteLength = Buffer.byteLength(asString, "utf8");
  const buffer = Buffer.allocUnsafe(12 + byteLength);
  buffer.writeInt32LE(headerPrefixInt, 0);
  buffer.writeInt32LE(byteLength, 4);
  buffer.writeInt32LE(headerSuffixInt, 8);
  if (buffer.write(asString, 12, byteLength, "utf8") !== byteLength) {
    throw new Error("Failed to write message to buffer");
  }

  return buffer;
}

let currentMessageLength = 0;
const DEBUGGING = true;
function extractMessageLengthAndOffsetFromBytes(buffer: Buffer, offset: number) {
  const bufferLength = buffer.length;
  while (offset < bufferLength) {
    const headerStart = buffer.indexOf(headerPrefix, offset, "binary");
    if (headerStart === -1) {
      if (DEBUGGING) {
        console.error("No header found in buffer of length " + bufferLength + " starting at offset " + offset);
      }
      return headerInvalidNumber;
    }

    // [headerPrefix (4), byteLength (4), headerSuffix (4)]
    if (bufferLength <= headerStart + 12) {
      if (DEBUGGING) {
        console.error(
          "Not enough bytes for header in buffer of length " + bufferLength + " starting at offset " + offset,
        );
      }
      return headerInvalidNumber;
    }

    const prefix = buffer.readInt32LE(headerStart);
    const byteLengthInt = buffer.readInt32LE(headerStart + 4);
    const suffix = buffer.readInt32LE(headerStart + 8);

    if (prefix !== headerPrefixInt || suffix !== headerSuffixInt) {
      offset = headerStart + 1;
      currentMessageLength = 0;

      if (DEBUGGING) {
        console.error(
          "Invalid header in buffer of length " + bufferLength + " starting at offset " + offset + ": " + prefix,
          byteLengthInt,
          suffix,
        );
      }
      continue;
    }

    if (byteLengthInt < 0) {
      if (DEBUGGING) {
        console.error(
          "Invalid byteLength in buffer of length " + bufferLength + " starting at offset " + offset + ": " + prefix,
          byteLengthInt,
          suffix,
        );
      }

      return headerInvalidNumber;
    }

    if (byteLengthInt === 0) {
      // Ignore 0-length messages
      // Shouldn't happen in practice
      offset = headerStart + 12;
      currentMessageLength = 0;

      if (DEBUGGING) {
        console.error(
          "Ignoring 0-length message in buffer of length " + bufferLength + " starting at offset " + offset,
        );
        console.error({
          buffer: buffer,
          string: buffer.toString(),
        });
      }

      continue;
    }

    currentMessageLength = byteLengthInt;

    return headerStart + 12;
  }

  if (DEBUGGING) {
    if (bufferLength > 0)
      console.error("Header not found in buffer of length " + bufferLength + " starting at offset " + offset);
  }

  return headerInvalidNumber;
}

class StreamingReader {
  pendingBuffer: Buffer;

  constructor() {
    this.pendingBuffer = Buffer.alloc(0);
  }

  *onMessage(chunk: Buffer) {
    let buffer: Buffer;
    if (this.pendingBuffer.length > 0) {
      this.pendingBuffer = buffer = Buffer.concat([this.pendingBuffer, chunk]);
    } else {
      this.pendingBuffer = buffer = chunk;
    }

    currentMessageLength = 0;

    for (
      let offset = extractMessageLengthAndOffsetFromBytes(buffer, 0);
      buffer.length > 0 && offset !== headerInvalidNumber;
      currentMessageLength = 0, offset = extractMessageLengthAndOffsetFromBytes(buffer, 0)
    ) {
      const messageLength = currentMessageLength;
      const start = offset;
      const end = start + messageLength;
      offset = end;
      const messageChunk = buffer.slice(start, end);
      this.pendingBuffer = buffer = buffer.slice(offset);
      yield messageChunk.toString();
    }
  }
}

export class JSCClient {
  #options: JSCClientOptions;
  #requestId: number;
  #pendingMessages: Buffer[];
  #pendingRequests: Map<number, (result: unknown) => void>;
  #socket: Socket;
  #ready?: Promise<void>;
  #reader = new StreamingReader();
  signal?: AbortSignal;

  constructor(options: JSCClientOptions) {
    this.#options = options;
    this.#socket = undefined;
    this.#requestId = 1;

    this.#pendingMessages = [];
    this.#pendingRequests = new Map();
  }

  get ready(): Promise<void> {
    if (!this.#ready) {
      this.#ready = this.#connect();
    }
    return this.#ready;
  }

  #connect(): Promise<void> {
    const { url, retry, onError, onResponse, onEvent, onClose } = this.#options;
    let [host, port] = typeof url === "string" ? url.split(":") : [url.hostname, url.port];
    if (port == null) {
      if (host == null) {
        host = "localhost";
        port = "9229";
      } else {
        port = "9229";
      }
    }

    if (host == null) {
      host = "localhost";
    }
    var resolve,
      reject,
      promise = new Promise<void>((r1, r2) => {
        resolve = r1;
        reject = r2;
      }),
      socket: Socket;
    let didConnect = false;

    this.#socket = socket = createConnection(
      {
        host,
        port: Number(port),
      },
      () => {
        for (const message of this.#pendingMessages) {
          this.#send(message);
        }
        this.#pendingMessages.length = 0;
        didConnect = true;
        resolve();
      },
    )
      .once("error", e => {
        const error = new Error(`Socket error: ${e?.message || e}`);
        reject(error);
      })
      .on("data", buffer => {
        for (const message of this.#reader.onMessage(buffer)) {
          let received: JSC.Event | JSC.Response;
          try {
            received = JSON.parse(message);
          } catch {
            const error = new Error(`Invalid WebSocket data: ${inspect(message)}`);
            onError?.(error);
            return;
          }
          console.log({ received });
          if ("id" in received) {
            onResponse?.(received);
            if ("error" in received) {
              const { message, code = "?" } = received.error;
              const error = new Error(`${message} [code: ${code}]`);
              onError?.(error);
              this.#pendingRequests.get(received.id)?.(error);
            } else {
              this.#pendingRequests.get(received.id)?.(received.result);
            }
          } else {
            onEvent?.(received);
          }
        }
      })
      .on("close", hadError => {
        if (didConnect) {
          onClose?.(hadError ? 1 : 0, "Socket closed");
        }
      });

    return promise;
  }

  #send(message: any): void {
    const socket = this.#socket;
    const framed = writeJSONMessageToBuffer(message);
    if (socket && !socket.connecting) {
      socket.write(framed);
    } else {
      this.#pendingMessages.push(framed);
    }
  }

  async fetch<T extends keyof JSC.RequestMap>(
    method: T,
    params?: JSC.Request<T>["params"],
  ): Promise<JSC.ResponseMap[T]> {
    const request: JSC.Request<T> = {
      id: this.#requestId++,
      method,
      params,
    };
    this.#options.onRequest?.(request);
    return new Promise((resolve, reject) => {
      const done = (result: Error | JSC.ResponseMap[T]) => {
        this.#pendingRequests.delete(request.id);
        if (result instanceof Error) {
          reject(result);
        } else {
          resolve(result);
        }
      };
      this.#pendingRequests.set(request.id, done);
      this.#send(request);
    });
  }

  close(): void {
    if (this.#socket) this.#socket.end();
  }
}
