import type * as BunType from "bun";

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
      if (DEBUGGING) {
        console.log({
          message: messageChunk.toString(),
        });
      }

      yield messageChunk.toString();
    }
  }
}

function writeJSONMessageToArrayBufferSink(sink: BunType.ArrayBufferSink, message: string) {
  sink.write(messageLengthBuffer);
  const written = sink.write(message);
  const outbuffer = sink.flush();
  new DataView(outbuffer as ArrayBuffer).setInt32(4, written, true);
  return outbuffer as ArrayBuffer;
}

class SocketListener {
  debugger: Debugger;
  perMessageSink: BunType.ArrayBufferSink;
  streamingReader: StreamingReader;
  writeBuffer: BunType.ArrayBufferSink;
  writeBufferLength: number = 0;
  socket: BunType.TCPSocket;
  listener: BunType.TCPSocketListener;

  constructor(d: Debugger, url: string) {
    this.debugger = d;
    if (url.startsWith("file://")) {
      url = Bun.fileURLToPath(url as any);
    }

    let [hostname, port] = url.split(":");
    if (port == null) {
      port = hostname;
      hostname = "localhost";
    }

    this.streamingReader = new StreamingReader();
    this.perMessageSink = new Bun.ArrayBufferSink();
    this.perMessageSink.start({
      highWaterMark: 4096,
      stream: true,
    });
    this.writeBuffer = new Bun.ArrayBufferSink();

    this.listener = Bun.listen({
      hostname,
      port: Number(port),
      socket: {
        open: socket => {
          this.socket = socket;
          console.error("Inspector connection opened", new Date().toString());
        },
        drain: socket => {
          if (this.writeBufferLength) {
            const writable = this.writeBuffer.flush() as Uint8Array;
            const written = socket.write(writable);
            socket.flush();
            const leftover = writable.subarray(written);
            if (leftover.byteLength > 0) {
              this.writeBuffer.start({
                asUint8Array: true,
                highWaterMark: leftover.byteLength,
              });
              this.writeBuffer.write(leftover);
              this.writeBufferLength = leftover.byteLength;
            } else {
              this.writeBufferLength = 0;
            }
          }
        },
        data: (socket, data) => {
          for (let msg of this.streamingReader.onMessage(data)) {
            this.debugger.onReceiveMessageFromRemote(msg);
          }
        },
        close: () => {
          console.error("Inspector connection closed", new Date().toString());
        },
      },
    });
    this.listener.ref();
  }

  write(msg: any) {
    let { perMessageSink, socket, writeBufferLength, writeBuffer } = this;
    const arrayBuffer = writeJSONMessageToArrayBufferSink(perMessageSink, msg);
    let remaining = arrayBuffer.byteLength,
      written = 0;
    console.log("write", msg);
    if (writeBufferLength === 0) {
      written = socket.write(arrayBuffer);
      if (written === remaining) {
        socket.flush();
        // done, nothing left to do
        return;
      }

      remaining -= written;
    }

    if (!writeBuffer) {
      this.writeBuffer = writeBuffer = new Bun.ArrayBufferSink();
      writeBuffer.start({
        highWaterMark: remaining,
        asUint8Array: true,
      });
    }

    this.writeBufferLength += writeBuffer.write(written === 0 ? arrayBuffer : arrayBuffer.slice(written));
  }
}

class WebSocketListener {
  debugger: Debugger;
  server: BunType.Server;
  url: string = "";
  queuedMessages = new Array<string>();
  constructor(d: Debugger, url: string) {
    this.debugger = d;

    this.server = this.start(url);
  }

  write(msg: string) {
    if (this.server.pendingWebSockets === 0) {
      this.queuedMessages.push(msg);
      return;
    }

    this.server.publish("clients", msg);
  }

  start(url: string): BunType.Server {
    try {
      var { hostname, port, pathname } = new URL("/" + crypto.randomUUID(), url);
      this.url = pathname.toLowerCase();
    } catch (e) {
      console.error("Bun inspector failed to parse url", url);
      process.exit(1);
    }

    const server = (this.server = Bun.serve({
      hostname,
      port: Number(port),
      websocket: {
        open: socket => {
          socket.subscribe("clients");

          for (let msg of this.queuedMessages) {
            server.publish("clients", msg);
          }
          this.queuedMessages.length = 0;
        },
        message: (socket, message) => {
          if (typeof message !== "string") {
            console.warn("Bun inspector received non-string message", message, "ignoring it.");
            return;
          }

          this.debugger.onReceiveMessageFromRemote(message as string);
        },
        close: () => {
          console.error("Inspector connection closed", new Date().toString());
        },
      },
      fetch: (req, server) => {
        const { pathname } = new URL(req.url);
        if (pathname.toLowerCase() === this.url) {
          if (server.upgrade(req)) {
            return new Response();
          }

          return new Response("WebSocket expected", {
            status: 400,
          });
        }

        if (pathname === "/") {
          // show the welcome to bun page
          return;
        }

        return new Response("Not found", {
          status: 404,
        });
      },
    }));

    console.log("");
    console.log("");
    console.log("Bun inspector listening on");
    console.log("");
    console.log(`ws://${hostname}:${port}${this.url}`);
    console.log("");

    return server;
  }
}

class Debugger {
  listener: SocketListener | WebSocketListener;
  constructor(public sendMessageToInspector: (msg: string) => void, hostOrPort: string) {
    if (hostOrPort.startsWith("ws:") || !hostOrPort.startsWith("wss:")) {
      this.listener = new WebSocketListener(this, hostOrPort);
    } else {
      this.listener = new SocketListener(this, hostOrPort);
    }
  }

  send(msg: string) {
    this.sendMessageToInspector(msg);
  }

  onReceiveMessageFromRemote(msg: string) {
    this.sendMessageToInspector(msg);
  }

  onReceiveMessageFromWebKit(...msgs: string[]) {
    const { listener } = this;

    for (var msg of msgs) {
      try {
        listener.write(msg);
      } catch (e) {
        console.error(e);
      }
    }
  }
}

export default function start(debuggerId, hostOrPort, sendMessageToInspector) {
  var instance = new Debugger(sendMessageToInspector.bind(debuggerId), hostOrPort);
  return instance.onReceiveMessageFromWebKit.bind(instance);
}
