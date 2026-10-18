// Works with both:
// - bun bd test test/js/node/http2/node-http2-max-concurrent-streams.test.ts
// - node --test test/js/node/http2/node-http2-max-concurrent-streams.test.ts
import assert from "node:assert";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import http2 from "node:http2";
import net from "node:net";
import path from "node:path";
import { Duplex } from "node:stream";
import { text } from "node:stream/consumers";
import { describe, test } from "node:test";
import tls from "node:tls";
import { format } from "node:util";

const keys = path.join(import.meta.dirname, "..", "test", "fixtures", "keys");
const tlsCert = {
  cert: fs.readFileSync(path.join(keys, "agent1-cert.pem"), "utf8"),
  key: fs.readFileSync(path.join(keys, "agent1-key.pem"), "utf8"),
};
const bunOnly = { skip: typeof Bun === "undefined" };

/** `test.each` of bun:test: one test for each row, and the row is the argument list of `body`. */
function each(rows: readonly unknown[], options: { skip?: boolean } = {}) {
  return (name: string, body: (...row: any[]) => unknown) => {
    for (const row of rows) {
      const args = Array.isArray(row) ? row : [row];
      const used = name.match(/%[sd]/g)?.length ?? 0;
      test(format(name, ...args.slice(0, used)), options, () => body(...args));
    }
  };
}

/** `describe.each` of bun:test. */
function describeEach(rows: readonly unknown[]) {
  return (name: string, body: (...row: any[]) => void) => {
    for (const row of rows) {
      const args = Array.isArray(row) ? row : [row];
      const used = name.match(/%[sd]/g)?.length ?? 0;
      describe(format(name, ...args.slice(0, used)), () => body(...args));
    }
  };
}

const PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n", "latin1");
const DATA = 0x0;
const HEADERS = 0x1;
const PRIORITY = 0x2;
const RST_STREAM = 0x3;
const SETTINGS = 0x4;
const PING = 0x6;
const GOAWAY = 0x7;
const WINDOW_UPDATE = 0x8;
const CONTINUATION = 0x9;
const END_STREAM = 0x1;
const END_HEADERS = 0x4;
const ACK = 0x1;
const REFUSED_STREAM = http2.constants.NGHTTP2_REFUSED_STREAM;
const CANCEL = http2.constants.NGHTTP2_CANCEL;
const NO_ERROR = http2.constants.NGHTTP2_NO_ERROR;
const PROTOCOL_ERROR = http2.constants.NGHTTP2_PROTOCOL_ERROR;
const INTERNAL_ERROR = http2.constants.NGHTTP2_INTERNAL_ERROR;
const ENHANCE_YOUR_CALM = http2.constants.NGHTTP2_ENHANCE_YOUR_CALM;

type Frame = { type: number; flags: number; streamId: number; payload: Buffer };

function frame(type: number, flags: number, streamId: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(9);
  header.writeUIntBE(payload.length, 0, 3);
  header.writeUInt8(type, 3);
  header.writeUInt8(flags, 4);
  header.writeUInt32BE(streamId, 5);
  return Buffer.concat([header, payload]);
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value, 0);
  return buffer;
}

// :method GET or POST, :scheme http, :path /, and a literal :authority. No dynamic table entry.
function requestBlock(method: "GET" | "POST"): Buffer {
  const authority = Buffer.from("localhost", "latin1");
  return Buffer.concat([Buffer.from([method === "POST" ? 0x83 : 0x82, 0x86, 0x84, 0x01, authority.length]), authority]);
}

/** An HPACK string literal without Huffman coding. */
function literal(text: string): Buffer {
  return Buffer.concat([Buffer.from([text.length]), Buffer.from(text, "latin1")]);
}

/** A complete request. */
const get = (streamId: number) => frame(HEADERS, END_STREAM | END_HEADERS, streamId, requestBlock("GET"));
/** A request whose body stays open. */
const upload = (streamId: number) => frame(HEADERS, END_HEADERS, streamId, requestBlock("POST"));
const endOfBody = (streamId: number) => frame(DATA, END_STREAM, streamId);
const cancel = (streamId: number) => frame(RST_STREAM, 0, streamId, u32(CANCEL));

/** A raw HTTP/2 client. It has no timers: a wait ends with a frame or with the end of the connection. */
class RawClient {
  frames: Frame[] = [];
  closed = false;
  #buffered = Buffer.alloc(0);
  #waiters: Array<{ matches: (f: Frame) => boolean; resolve: (f: Frame | null) => void }> = [];
  #opened = new Set<number>();

  socket: net.Socket;

  constructor(socket: net.Socket) {
    this.socket = socket;
    socket.on("error", () => {});
    socket.on("close", () => {
      this.closed = true;
      for (const waiter of this.#waiters.splice(0)) waiter.resolve(null);
    });
    socket.on("data", chunk => {
      this.#buffered = Buffer.concat([this.#buffered, chunk]);
      while (this.#buffered.length >= 9) {
        const length = this.#buffered.readUIntBE(0, 3);
        if (this.#buffered.length < 9 + length) break;
        const received: Frame = {
          type: this.#buffered.readUInt8(3),
          flags: this.#buffered.readUInt8(4),
          streamId: this.#buffered.readUInt32BE(5) & 0x7fffffff,
          payload: Buffer.from(this.#buffered.subarray(9, 9 + length)),
        };
        this.#buffered = this.#buffered.subarray(9 + length);
        this.frames.push(received);
        const index = this.#waiters.findIndex(waiter => waiter.matches(received));
        if (index !== -1) this.#waiters.splice(index, 1)[0].resolve(received);
      }
    });
  }

  static async connect(server: net.Server, secure = false): Promise<RawClient> {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as net.AddressInfo).port;
    const socket = secure
      ? tls.connect({ port, host: "127.0.0.1", ALPNProtocols: ["h2"], rejectUnauthorized: false })
      : net.connect(port, "127.0.0.1");
    await once(socket, secure ? "secureConnect" : "connect");
    const client = new RawClient(socket);
    socket.write(Buffer.concat([PREFACE, frame(SETTINGS, 0, 0)]));
    return client;
  }

  /** Resolves with the first frame that matches, or with null when the connection ended first. */
  waitFor(matches: (f: Frame) => boolean): Promise<Frame | null> {
    const existing = this.frames.find(matches);
    if (existing) return Promise.resolve(existing);
    if (this.closed) return Promise.resolve(null);
    return new Promise(resolve => this.#waiters.push({ matches, resolve }));
  }

  /** One write, so that the server reads the frames in one chunk. */
  send(...frames: Buffer[]) {
    for (const sent of frames) if (sent.readUInt8(3) === HEADERS) this.#opened.add(sent.readUInt32BE(5));
    this.socket.write(Buffer.concat(frames));
  }

  /** Resolves when each request has its response HEADERS or its RST_STREAM, or the session ended. */
  async answers() {
    for (const streamId of this.#opened) {
      await this.waitFor(
        f => f.type === GOAWAY || (f.streamId === streamId && (f.type === HEADERS || f.type === RST_STREAM)),
      );
    }
  }

  get(streamId: number) {
    this.send(get(streamId));
  }

  /** A request whose body stays open. */
  upload(streamId: number) {
    this.send(upload(streamId));
  }

  /** True when the server answered the PING. False when it sent GOAWAY or closed the connection. */
  async ping(tag: number): Promise<boolean> {
    const payload = Buffer.alloc(8);
    payload.writeUInt32BE(tag, 0);
    this.socket.write(frame(PING, 0, 0, payload));
    const answer = await this.waitFor(
      f => f.type === GOAWAY || (f.type === PING && (f.flags & ACK) !== 0 && f.payload.equals(payload)),
    );
    return answer?.type === PING;
  }

  goawayCodes(): number[] {
    return this.frames.filter(f => f.type === GOAWAY).map(f => f.payload.readUInt32BE(4));
  }

  resets(): Array<[number, number]> {
    return this.frames.filter(f => f.type === RST_STREAM).map(f => [f.streamId, f.payload.readUInt32BE(0)]);
  }
}

type Served = { handlers: number[]; sessionError?: string };
type OnStream = (stream: http2.ServerHttp2Stream, headers: http2.IncomingHttpHeaders) => void;
type OnRequest = (req: http2.Http2ServerRequest, res: http2.Http2ServerResponse) => void;

const odd = (count: number, first = 1) => Array.from({ length: count }, (_, i) => first + 2 * i);
const refused = (streamIds: number[]) => streamIds.map(streamId => [streamId, REFUSED_STREAM]);

/** Answers and keeps the stream open. */
const hold: OnStream = stream => {
  stream.respond({ ":status": 200 });
  stream.write("hello");
};
/** Answers and ends the response in the same turn. */
const finish: OnStream = stream => {
  stream.respond({ ":status": 200 });
  stream.end("ok");
};

/** The first answer to a request: the response HEADERS or a reset. */
const answered = (streamId: number) => (f: Frame) =>
  f.type === GOAWAY || ((f.type === HEADERS || f.type === RST_STREAM) && f.streamId === streamId);
/** The end of a response. */
const ended = (streamId: number) => (f: Frame) =>
  f.type === GOAWAY ||
  (f.type === RST_STREAM && f.streamId === streamId) ||
  ((f.type === DATA || f.type === HEADERS) && f.streamId === streamId && (f.flags & END_STREAM) !== 0);

/** Records the streams that reach `onStream`, and the error that ends a session. */
function record(
  source: http2.Http2Server | http2.Http2SecureServer | http2.ServerHttp2Session,
  served: Served,
  onStream: OnStream,
) {
  source.on("stream", (stream: http2.ServerHttp2Stream, headers: http2.IncomingHttpHeaders) => {
    served.handlers.push(stream.id!);
    stream.on("error", () => {});
    onStream(stream, headers);
  });
  if ("settings" in source) {
    source.on("error", (err: NodeJS.ErrnoException) => (served.sessionError = err.code));
  } else {
    source.on("sessionError", (err: NodeJS.ErrnoException) => (served.sessionError = err.code));
    source.on("session", session => session.on("error", () => {}));
  }
}

async function withClient<T>(server: net.Server, body: (client: RawClient) => Promise<T>, secure = false) {
  // A session that has ended does not listen to its socket. The reset of the client can still arrive.
  server.on("connection", socket => socket.on("error", () => {}));
  const client = await RawClient.connect(server, secure);
  try {
    return await body(client);
  } finally {
    client.socket.destroy();
    server.close();
  }
}

/** A server of the core API with its `options`, and a raw client on it. */
function withLimit<T>(
  options: http2.ServerOptions,
  onStream: OnStream,
  body: (client: RawClient, served: Served) => Promise<T>,
): Promise<T> {
  const served: Served = { handlers: [] };
  const server = http2.createServer(options);
  record(server, served, onStream);
  return withClient(server, client => body(client, served));
}

/** A server of the compatibility API that records the requests that reach `onRequest`. */
function compatServer(options: http2.ServerOptions, served: Served, onRequest: OnRequest) {
  const server = http2.createServer(options, (req, res) => {
    served.handlers.push(req.stream.id!);
    req.on("error", () => {});
    res.on("error", () => {});
    onRequest(req, res);
  });
  server.on("sessionError", (err: NodeJS.ErrnoException) => (served.sessionError = err.code));
  server.on("session", session => session.on("error", () => {}));
  return server;
}

/** The same as withLimit() with a request listener of the compatibility API. */
function withCompat<T>(
  options: http2.ServerOptions,
  onRequest: OnRequest,
  body: (client: RawClient, served: Served) => Promise<T>,
): Promise<T> {
  const served: Served = { handlers: [] };
  return withClient(compatServer(options, served, onRequest), client => body(client, served));
}

/** What the server did up to now. */
function seen(client: RawClient, served: Served) {
  return {
    handlers: served.handlers,
    answered: [...new Set(client.frames.filter(f => f.type === HEADERS).map(f => f.streamId))].sort((a, b) => a - b),
    resets: client.resets(),
    goaways: client.goawayCodes(),
    sessionError: served.sessionError,
  };
}

/** What the server did, read when it has answered a PING and every request, or ended the connection. */
async function outcome(client: RawClient, served: Served, tag = 1) {
  if (await client.ping(tag)) await client.answers();
  else if (!client.closed) await once(client.socket, "close");
  return seen(client, served);
}

const allServed = (streamIds: number[]) => ({
  handlers: streamIds,
  answered: streamIds,
  resets: [],
  goaways: [],
  sessionError: undefined,
});

/** Opens each request when the response to the request before it has ended. */
async function oneAtATime(client: RawClient, served: Served, count: number) {
  for (const streamId of odd(count)) {
    client.send(get(streamId));
    await client.waitFor(ended(streamId));
  }
  return outcome(client, served);
}

/** Opens `count` complete requests in one write. */
function inOneWrite(count: number) {
  return (client: RawClient, served: Served) => {
    client.send(...odd(count).map(get));
    return outcome(client, served);
  };
}

/** Answers and keeps the stream open, through the compatibility API. */
const holdResponse: OnRequest = (_req, res) => {
  res.writeHead(200);
  res.write("hello");
};

/** A server whose sessions read from a Duplex, so the bytes reach the parser through JS. */
function duplexFed(options: http2.ServerOptions, served: Served, onStream: OnStream) {
  return net.createServer(socket => {
    const duplex = new Duplex({
      read() {},
      write(chunk, _encoding, callback) {
        socket.write(chunk, callback);
      },
      final(callback) {
        socket.end(callback);
      },
    });
    socket.on("data", chunk => duplex.push(chunk));
    socket.on("end", () => duplex.push(null));
    socket.on("error", () => {});
    record(http2.performServerHandshake(duplex, options), served, onStream);
  });
}

/** Every way to get a server session. Each one answers a request and keeps its stream open. */
const entryPoints: Array<
  [name: string, secure: boolean, listen: (options: http2.ServerOptions, served: Served) => net.Server]
> = [
  [
    "a server of the core API",
    false,
    (options, served) => {
      const server = http2.createServer(options);
      record(server, served, hold);
      return server;
    },
  ],
  ["a server of the compatibility API", false, (options, served) => compatServer(options, served, holdResponse)],
  [
    "a TLS server",
    true,
    (options, served) => {
      const server = http2.createSecureServer({ ...tlsCert, ...options });
      record(server, served, hold);
      return server;
    },
  ],
  ["performServerHandshake() over a Duplex", false, (options, served) => duplexFed(options, served, hold)],
];

const respondThenTrailers: OnStream = stream => {
  stream.respond({ ":status": 200 }, { waitForTrailers: true });
  stream.on("wantTrailers", () => stream.sendTrailers({ "x-checksum": "1" }));
  stream.end("ok");
};
const headersOnly: OnStream = stream => stream.respond({ ":status": 200 }, { endStream: true });
const endResponse: OnRequest = (_req, res) => {
  res.writeHead(200);
  res.end("ok");
};

// A request over the SETTINGS_MAX_CONCURRENT_STREAMS that the server advertised gets
// RST_STREAM(REFUSED_STREAM) and no 'stream' event (RFC 9113 5.1.2). A stream uses one slot of the
// limit from its HEADERS until both sides ended it or one side reset it. These tests pin every
// order in which a slot is taken and given back. None of them reaches a budget. Every expectation
// is what node v26.3.0 does. A test that says "Bun only" has no counterpart in node.
describe("the slots of SETTINGS_MAX_CONCURRENT_STREAMS", () => {
  const one = { settings: { maxConcurrentStreams: 1 } };

  test("limit 0 refuses every stream", async () => {
    const result = await withLimit({ settings: { maxConcurrentStreams: 0 } }, finish, inOneWrite(2));
    assert.deepStrictEqual(result, {
      handlers: [],
      answered: [],
      resets: refused([1, 3]),
      goaways: [],
      sessionError: undefined,
    });
  });

  test("requests in one write are refused while the first response waits for a later turn", async () => {
    const later: OnStream = (stream, headers) => void setImmediate(finish, stream, headers);
    const result = await withLimit(one, later, async (client, served) => {
      client.send(...odd(3).map(get));
      await client.waitFor(ended(1));
      return outcome(client, served);
    });
    assert.deepStrictEqual(result, {
      handlers: [1],
      answered: [1],
      resets: refused([3, 5]),
      goaways: [],
      sessionError: undefined,
    });
  });

  each(entryPoints)("requests over the limit in one write are refused by %s", async (_, secure, listen) => {
    const served: Served = { handlers: [] };
    const server = listen({ settings: { maxConcurrentStreams: 2 } }, served);
    assert.deepStrictEqual(await withClient(server, client => inOneWrite(5)(client, served), secure), {
      handlers: [1, 3],
      answered: [1, 3],
      resets: refused([5, 7, 9]),
      goaways: [],
      sessionError: undefined,
    });
  });

  describe("a slot is free again", () => {
    test("after both sides ended the stream", async () => {
      assert.deepStrictEqual(
        await withLimit(one, finish, (client, served) => oneAtATime(client, served, 5)),
        allServed(odd(5)),
      );
    });

    test("after a response that is only HEADERS", async () => {
      assert.deepStrictEqual(
        await withLimit(one, headersOnly, (client, served) => oneAtATime(client, served, 4)),
        allServed(odd(4)),
      );
    });

    test("after sendTrailers()", async () => {
      assert.deepStrictEqual(
        await withLimit(one, respondThenTrailers, (client, served) => oneAtATime(client, served, 4)),
        allServed(odd(4)),
      );
    });

    test("after res.end() of the compatibility API", async () => {
      assert.deepStrictEqual(
        await withCompat(one, endResponse, (client, served) => oneAtATime(client, served, 4)),
        allServed(odd(4)),
      );
    });

    // The body is larger than the stream window of the peer, so its end waits in the queue of
    // the session for a WINDOW_UPDATE.
    test("after the end of a response that waited for the window of the peer", async () => {
      const body = Buffer.alloc(100_000, "a");
      const large: OnStream = stream => {
        stream.respond({ ":status": 200 });
        stream.end(body);
      };
      const result = await withLimit(one, large, async (client, served) => {
        const received = (streamId: number) =>
          client.frames.reduce((n, f) => (f.type === DATA && f.streamId === streamId ? n + f.payload.length : n), 0);
        for (const streamId of odd(3)) {
          client.send(get(streamId));
          await client.waitFor(f => f.type === GOAWAY || received(streamId) >= 65_535);
          client.send(frame(WINDOW_UPDATE, 0, 0, u32(1 << 20)), frame(WINDOW_UPDATE, 0, streamId, u32(1 << 20)));
          await client.waitFor(ended(streamId));
        }
        return outcome(client, served);
      });
      assert.deepStrictEqual(result, allServed(odd(3)));
    });

    // The response ends first. The request ends in the same write as the next request.
    test("after the request ended, in one write with the next request", async () => {
      const answerAtOnce: OnStream = (stream, headers) => {
        stream.resume();
        finish(stream, headers);
      };
      const result = await withLimit(one, answerAtOnce, async (client, served) => {
        client.send(upload(1));
        for (const streamId of odd(4)) {
          await client.waitFor(ended(streamId));
          client.send(endOfBody(streamId), upload(streamId + 2));
        }
        await client.waitFor(ended(9));
        return outcome(client, served);
      });
      assert.deepStrictEqual(result, allServed(odd(5)));
    });

    // The server has answered and still writes when the reset arrives.
    function resetThenNextRequest(code: number, count: number) {
      return async (client: RawClient, served: Served) => {
        client.send(upload(1));
        for (const streamId of odd(count - 1)) {
          await client.waitFor(answered(streamId));
          client.send(frame(RST_STREAM, 0, streamId, u32(code)), upload(streamId + 2));
        }
        await client.waitFor(answered(2 * count - 1));
        return outcome(client, served);
      };
    }

    each([
      ["CANCEL", CANCEL],
      ["NO_ERROR", http2.constants.NGHTTP2_NO_ERROR],
      ["INTERNAL_ERROR", http2.constants.NGHTTP2_INTERNAL_ERROR],
      ["REFUSED_STREAM", REFUSED_STREAM],
    ])("after RST_STREAM(%s) from the peer, in one write with the next request", async (_, code) => {
      assert.deepStrictEqual(await withLimit(one, hold, resetThenNextRequest(code, 5)), allServed(odd(5)));
    });

    // Bun answers the reset of these streams with a reset of its own. Node does not.
    const withoutOwnResets = ({ resets, ...rest }: Awaited<ReturnType<typeof outcome>>) => ({
      ...rest,
      resets: resets.filter(([, code]) => code !== CANCEL),
    });

    test("after the peer reset a stream that waits for trailers, in one write with the next request", async () => {
      const waitForTrailers: OnStream = stream => {
        stream.respond({ ":status": 200 }, { waitForTrailers: true });
        stream.write("hello");
      };
      const result = await withLimit(one, waitForTrailers, resetThenNextRequest(CANCEL, 9));
      assert.deepStrictEqual(withoutOwnResets(result), allServed(odd(9)));
    });

    test("after the peer reset a request of the compatibility API, in one write with the next request", async () => {
      const result = await withCompat(one, holdResponse, resetThenNextRequest(CANCEL, 9));
      assert.deepStrictEqual(withoutOwnResets(result), allServed(odd(9)));
    });

    each([
      ["CANCEL", CANCEL],
      ["NO_ERROR", http2.constants.NGHTTP2_NO_ERROR],
    ])("after the server reset the stream with close(%s)", async (_, code) => {
      const reset: OnStream = stream => {
        stream.respond({ ":status": 200 });
        stream.close(code);
      };
      const result = await withLimit(one, reset, async (client, served) => {
        for (const streamId of odd(4)) {
          client.send(upload(streamId));
          await client.waitFor(f => f.type === GOAWAY || (f.type === RST_STREAM && f.streamId === streamId));
        }
        return outcome(client, served);
      });
      // The destroy that follows close() can write the RST_STREAM a second time.
      const resets = [...new Set(result.resets.map(([streamId, rstCode]) => `${streamId}:${rstCode}`))];
      assert.deepStrictEqual(
        { ...result, resets },
        {
          ...allServed(odd(4)),
          resets: odd(4).map(streamId => `${streamId}:${code}`),
        },
      );
    });

    // Bun only: these calls fail in Bun and the stream emits 'error'. Node accepts the first two,
    // throws for the third and resets the stream for the fourth.
    each(
      [
        ["a weight out of range", {}, (stream: any) => stream.respond({ ":status": 200 }, { weight: 0 })],
        ["a parent out of range", {}, (stream: any) => stream.respond({ ":status": 200 }, { parent: -1 })],
        ["options that are not an object", {}, (stream: any) => stream.respond({ ":status": 200 }, 1)],
        [
          "a header block over maxSendHeaderBlockLength",
          { maxSendHeaderBlockLength: 100 },
          (stream: any) => stream.respond({ ":status": 200, "x-large": Buffer.alloc(400, "a").toString() }),
        ],
      ],
      bunOnly,
    )("after respond() failed for %s", async (_, options, failingRespond) => {
      const failFirst: OnStream = (stream, headers) => {
        if (stream.id === 1) failingRespond(stream);
        else hold(stream, headers);
      };
      const result = await withLimit({ ...one, ...options }, failFirst, async (client, served) => {
        client.send(upload(1));
        await client.ping(1);
        client.send(upload(3));
        return { handlers: served.handlers, next: (await client.waitFor(answered(3)))?.type };
      });
      assert.deepStrictEqual(result, { handlers: [1, 3], next: HEADERS });
    });
  });

  // The limit of a session that starts with no limit, set before the first request arrives.
  each([
    [
      "session.settings() in the 'session' event",
      (server: http2.Http2Server) => {
        server.on("session", session => session.settings({ maxConcurrentStreams: 2 }));
      },
    ],
    [
      "server.updateSettings() before the connection",
      (server: http2.Http2Server) => {
        server.updateSettings({ maxConcurrentStreams: 2 });
      },
    ],
  ])("%s sets the limit for the first request", async (_, setLimit) => {
    const served: Served = { handlers: [] };
    const server = http2.createServer();
    setLimit(server);
    record(server, served, hold);
    const result = await withClient(server, client => inOneWrite(4)(client, served));
    assert.deepStrictEqual(result, {
      handlers: [1, 3],
      answered: [1, 3],
      resets: refused([5, 7]),
      goaways: [],
      sessionError: undefined,
    });
  });

  describe("session.settings()", () => {
    each([
      ["lowers", 100, 2, [1, 3], [5, 7, 9, 11]],
      ["raises", 1, 3, [1, 3, 5], [7]],
    ])("in a handler %s the limit for the next request of the same write", async (_, initial, next, served, over) => {
      const change: OnStream = (stream, headers) => {
        if (stream.id === 1) stream.session!.settings({ maxConcurrentStreams: next });
        hold(stream, headers);
      };
      const result = await withLimit(
        { settings: { maxConcurrentStreams: initial } },
        change,
        inOneWrite(served.length + over.length),
      );
      assert.deepStrictEqual(result, {
        handlers: served,
        answered: served,
        resets: refused(over),
        goaways: [],
        sessionError: undefined,
      });
    });

    test("keeps the open streams when it lowers the limit below their number", async () => {
      const lower: OnStream = (stream, headers) => {
        if (stream.id === 5) stream.session!.settings({ maxConcurrentStreams: 1 });
        hold(stream, headers);
      };
      const result = await withLimit({ settings: { maxConcurrentStreams: 5 } }, lower, async (client, served) => {
        client.send(upload(1), upload(3), upload(5), upload(7));
        await client.ping(1);
        client.send(cancel(1), cancel(3), upload(9));
        await client.ping(2);
        client.send(cancel(5), upload(11));
        return outcome(client, served, 3);
      });
      assert.deepStrictEqual(result, {
        handlers: [1, 3, 5, 11],
        answered: [1, 3, 5, 11],
        resets: refused([7, 9]),
        goaways: [],
        sessionError: undefined,
      });
    });
  });

  test("a trailer block on the one open stream is not a new stream", async () => {
    const trailers: number[] = [];
    const answerAfterBody: OnStream = (stream, headers) => {
      stream.on("trailers", () => trailers.push(stream.id!));
      stream.on("end", () => finish(stream, headers));
      stream.resume();
    };
    const result = await withLimit(one, answerAfterBody, async (client, served) => {
      const field = Buffer.concat([Buffer.from([0x00]), literal("x-checksum"), literal("1")]);
      client.send(
        upload(1),
        frame(DATA, 0, 1, Buffer.from("body")),
        frame(HEADERS, END_STREAM | END_HEADERS, 1, field),
      );
      await client.waitFor(ended(1));
      client.send(get(3));
      await client.waitFor(ended(3));
      return outcome(client, served);
    });
    assert.deepStrictEqual({ ...result, trailers }, { ...allServed([1, 3]), trailers: [1] });
  });

  // RFC 9113 5.1.2: a stream that the server pushed counts against the limit of the client.
  test("a pushed stream does not use a slot", async () => {
    const push: OnStream = (stream, headers) => {
      if (stream.id === 1) {
        for (let i = 0; i < 3; i++) {
          stream.pushStream({ ":path": `/pushed${i}` }, (err, pushed) => {
            if (err) return;
            pushed.on("error", () => {});
            hold(pushed, headers);
          });
        }
      }
      hold(stream, headers);
    };
    const result = await withLimit({ settings: { maxConcurrentStreams: 2 } }, push, async (client, served) => {
      client.send(get(1));
      await client.waitFor(answered(1));
      client.send(get(3), get(5));
      return outcome(client, served);
    });
    assert.deepStrictEqual(result, {
      handlers: [1, 3],
      answered: [1, 2, 3, 4, 6],
      resets: refused([5]),
      goaways: [],
      sessionError: undefined,
    });
  });

  // RFC 9113 4.3: the block of a refused stream changes the HPACK table of the connection.
  test("a field that a refused block added to the HPACK table is known to the next request", async () => {
    const fields: (string | string[] | undefined)[] = [];
    const recordField: OnStream = (stream, headers) => {
      fields.push(headers["x-bun-sync"]);
      hold(stream, headers);
    };
    const result = await withLimit(one, recordField, async (client, served) => {
      client.send(get(1));
      await client.waitFor(answered(1));
      // The refused block adds `x-bun-sync: 1` from its CONTINUATION frame. 0xbe is that entry.
      const insert = Buffer.concat([Buffer.from([0x40]), literal("x-bun-sync"), literal("1")]);
      client.send(
        frame(HEADERS, END_STREAM, 3, requestBlock("GET")),
        frame(CONTINUATION, END_HEADERS, 3, insert),
        cancel(1),
        frame(HEADERS, END_STREAM | END_HEADERS, 5, Buffer.concat([requestBlock("GET"), Buffer.from([0xbe])])),
      );
      return outcome(client, served);
    });
    assert.deepStrictEqual(
      { ...result, fields },
      {
        handlers: [1, 5],
        answered: [1, 5],
        resets: refused([3]),
        goaways: [],
        sessionError: undefined,
        fields: [undefined, "1"],
      },
    );
  });

  // A client that has not read the refusal keeps sending on the stream. A refused stream has
  // existed (RFC 9113 5.1), so these frames do not end the session, and they get no answer.
  test("the frames that follow a refused request in the same write get no answer", async () => {
    const result = await withLimit(one, hold, async (client, served) => {
      client.send(get(1));
      await client.waitFor(answered(1));
      const priority = Buffer.alloc(5);
      priority.writeUInt8(16, 4);
      client.send(
        upload(3),
        frame(DATA, 0, 3, Buffer.from("hello")),
        frame(WINDOW_UPDATE, 0, 3, u32(1000)),
        frame(PRIORITY, 0, 3, priority),
        cancel(3),
        cancel(1),
        get(5),
      );
      return outcome(client, served);
    });
    assert.deepStrictEqual(result, {
      handlers: [1, 5],
      answered: [1, 5],
      resets: refused([3]),
      goaways: [],
      sessionError: undefined,
    });
  });
});

/** A request whose block is malformed: it carries a `connection` field (RFC 9113 8.2.2). */
const malformed = (streamId: number) =>
  frame(
    HEADERS,
    END_STREAM | END_HEADERS,
    streamId,
    Buffer.concat([requestBlock("GET"), Buffer.from([0x00]), literal("connection"), literal("close")]),
  );

const withCode = (resets: Array<[number, number]>, code: number) => resets.filter(reset => reset[1] === code);

// A stream over the limit is refused before it exists. nghttp2 reports its HEADERS frame as an
// invalid frame, so node charges maxSessionInvalidFrames with `count++ > max`, and
// maxSessionRejectedStreams plays no part:
// https://github.com/nodejs/node/blob/v26.3.0/deps/nghttp2/lib/nghttp2_session.c#L3905-L3908
// https://github.com/nodejs/node/blob/v26.3.0/src/node_http2.cc#L1128-L1143
// Every expectation is what node v26.3.0 does, unless the test says that node differs.
describe("a stream refused over SETTINGS_MAX_CONCURRENT_STREAMS", () => {
  const one = { settings: { maxConcurrentStreams: 1 } };

  // A client does not know the limit before the SETTINGS of the server arrive, so it cannot
  // avoid this.
  describeEach([
    ["the default budgets", {}],
    ["maxSessionRejectedStreams: 3", { maxSessionRejectedStreams: 3 }],
  ])("a first flight of 150 requests at limit 10, with %s", (_, budgets) => {
    each(entryPoints)("keeps the session of %s", async (_, secure, listen) => {
      const served: Served = { handlers: [] };
      const server = listen({ settings: { maxConcurrentStreams: 10 }, ...budgets }, served);
      assert.deepStrictEqual(await withClient(server, client => inOneWrite(150)(client, served), secure), {
        handlers: odd(10),
        answered: odd(10),
        resets: refused(odd(140, 21)),
        goaways: [],
        sessionError: undefined,
      });
    });
  });

  each([
    [0, 1],
    [3, 4],
  ])("maxSessionInvalidFrames: %d allows %d refused streams", async (maxSessionInvalidFrames, allowed) => {
    const options = { ...one, maxSessionInvalidFrames, maxSessionRejectedStreams: 1 };
    await withLimit(options, hold, async (client, served) => {
      client.send(get(1));
      await client.waitFor(answered(1));
      client.send(...odd(allowed, 3).map(get));
      assert.deepStrictEqual(await outcome(client, served, 1), {
        handlers: [1],
        answered: [1],
        resets: refused(odd(allowed, 3)),
        goaways: [],
        sessionError: undefined,
      });
      // The next refusal uses up the allowance. It still gets its RST_STREAM, and the session
      // reads no frame after it.
      client.send(...odd(3, 3 + 2 * allowed).map(get));
      const result = await outcome(client, served, 2);
      const goaway = client.frames.find(f => f.type === GOAWAY);
      assert.deepStrictEqual(
        { ...result, lastStreamId: goaway?.payload.readUInt32BE(0) },
        {
          handlers: [1],
          answered: [1],
          resets: refused(odd(allowed + 1, 3)),
          goaways: [INTERNAL_ERROR],
          sessionError: "ERR_HTTP2_TOO_MANY_INVALID_FRAMES",
          // No refused stream was processed, so a client can send every one of them again.
          lastStreamId: 1,
        },
      );
    });
  });

  // nghttp2 closes a stream when it writes the frame that ends it, and it writes after it has read
  // every frame of the chunk. So the slot of 1 is not free for 3 and 5.
  describe("a stream that the handler ended keeps its slot until the read ends", () => {
    const firstOnly = { handlers: [1], answered: [1], resets: refused([3, 5]), goaways: [], sessionError: undefined };

    each([
      ["respond() and end()", finish],
      ["respond({ endStream: true })", headersOnly],
      ["sendTrailers()", respondThenTrailers],
    ])("with %s", async (_, handler) => {
      assert.deepStrictEqual(await withLimit(one, handler, inOneWrite(3)), firstOnly);
    });

    test("with res.end() of the compatibility API", async () => {
      assert.deepStrictEqual(await withCompat(one, endResponse, inOneWrite(3)), firstOnly);
    });

    test("when the end of the request body follows in the same write", async () => {
      const answerAtOnce: OnStream = (stream, headers) => {
        stream.resume();
        finish(stream, headers);
      };
      const result = await withLimit(one, answerAtOnce, async (client, served) => {
        client.send(upload(1), endOfBody(1), get(3));
        return outcome(client, served);
      });
      assert.deepStrictEqual(result, {
        handlers: [1],
        answered: [1],
        resets: refused([3]),
        goaways: [],
        sessionError: undefined,
      });
    });

    // Stream 1 is from an earlier read. The handler ends it at the first DATA frame of this read.
    test("when a stream from an earlier read ends on both sides in this read", async () => {
      const answerAtData: OnStream = (stream, headers) => {
        stream.once("data", () => finish(stream, headers));
      };
      const result = await withLimit(one, answerAtData, async (client, served) => {
        client.send(upload(1));
        await client.ping(1);
        client.send(frame(DATA, 0, 1, Buffer.from("body")), endOfBody(1), get(3));
        return outcome(client, served, 2);
      });
      assert.deepStrictEqual(result, {
        handlers: [1],
        answered: [1],
        resets: refused([3]),
        goaways: [],
        sessionError: undefined,
      });
    });

    // The handler feeds the next requests to the session from inside the read.
    test("for the bytes that a handler pushes into the Duplex of the session", async () => {
      const served: Served = { handlers: [] };
      const server = net.createServer(socket => {
        const duplex = new Duplex({
          read() {},
          write(chunk, _encoding, callback) {
            socket.write(chunk, callback);
          },
        });
        socket.on("data", chunk => duplex.push(chunk));
        socket.on("error", () => {});
        record(http2.performServerHandshake(duplex, one), served, (stream, headers) => {
          finish(stream, headers);
          if (stream.id === 1) duplex.push(Buffer.concat([get(3), get(5)]));
        });
      });
      const result = await withClient(server, async client => {
        client.send(get(1));
        await client.waitFor(ended(1));
        await client.waitFor(f => f.type === RST_STREAM && f.streamId === 5);
        return seen(client, served);
      });
      assert.deepStrictEqual(result, {
        handlers: [1],
        answered: [1],
        resets: refused([3, 5]),
        goaways: [],
        sessionError: undefined,
      });
    });

    // The RST_STREAM of the peer closes the stream when the server reads it.
    test("but not when the peer resets it in the same write", async () => {
      const result = await withLimit(one, finish, async (client, served) => {
        // Node writes no frame for stream 1, so outcome() would not return.
        client.send(get(1), cancel(1), get(3));
        await client.waitFor(f => f.streamId === 3 && (f.type === HEADERS || f.type === RST_STREAM));
        return seen(client, served);
      });
      assert.deepStrictEqual(
        { handlers: result.handlers, refused: withCode(result.resets, REFUSED_STREAM) },
        {
          handlers: [1, 3],
          refused: [],
        },
      );
    });
  });

  // The same through the public API. `peerMaxConcurrentStreams` lets the client of node send its
  // whole first flight, as the client of Bun does.
  test("a first flight through http2.connect() loses only the requests over the limit", async () => {
    const held: http2.ServerHttp2Stream[] = [];
    const server = http2.createServer({ settings: { maxConcurrentStreams: 10 } });
    server.on("session", session => session.on("error", () => {}));
    server.on("stream", stream => {
      stream.on("error", () => {});
      held.push(stream);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as net.AddressInfo;
    const client = http2.connect(`http://127.0.0.1:${port}`, { peerMaxConcurrentStreams: 1000 });
    client.on("error", () => {});
    try {
      const allRefused = Promise.withResolvers<void>();
      let closed = 0;
      const request = () =>
        new Promise<number | undefined>(resolve => {
          const stream = client.request({ ":path": "/" });
          let status: number | undefined;
          stream.on("response", headers => (status = headers[":status"]));
          stream.on("error", () => {});
          stream.on("close", () => {
            if (++closed === 110) allRefused.resolve();
            resolve(status ?? -stream.rstCode);
          });
          stream.resume();
          stream.end();
        });
      const requests = Array.from({ length: 120 }, request);
      await allRefused.promise;
      for (const stream of held.splice(0)) {
        stream.respond({ ":status": 200 });
        stream.end("ok");
      }
      const results = await Promise.all(requests);
      const next = request();
      const [last] = await Promise.all([next, once(server, "stream").then(([stream]) => finish(stream, {}))]);
      assert.deepStrictEqual(
        {
          served: results.filter(status => status === 200).length,
          refused: results.filter(status => status === -REFUSED_STREAM).length,
          last,
        },
        { served: 10, refused: 110, last: 200 },
      );
    } finally {
      client.destroy();
      server.close();
    }
  });

  // RFC 9113 5.1.2: the limit that a client advertises is for the streams that the server opens.
  test("the limit that a client advertises does not apply to its own requests", async () => {
    const server = http2.createServer();
    server.on("stream", stream => finish(stream, {}));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as net.AddressInfo;
    const client = http2.connect(`http://127.0.0.1:${port}`, { settings: { maxConcurrentStreams: 0 } });
    try {
      const request = () =>
        new Promise<number | undefined>((resolve, reject) => {
          const stream = client.request({ ":path": "/" });
          let status: number | undefined;
          stream.on("response", headers => (status = headers[":status"]));
          stream.on("error", reject);
          stream.on("close", () => resolve(status));
          stream.resume();
          stream.end();
        });
      assert.deepStrictEqual(await Promise.all([request(), request(), request()]), [200, 200, 200]);
    } finally {
      client.destroy();
      server.close();
    }
  });

  test("a refused stream and a malformed block use the same allowance", async () => {
    const options = { settings: { maxConcurrentStreams: 2 }, maxSessionInvalidFrames: 1 };
    const result = await withLimit(options, hold, async (client, served) => {
      client.send(get(1), get(3));
      await client.waitFor(answered(3));
      // 5 is over the limit. 7 is admitted and its block is malformed. The RST_STREAM of 7 goes
      // out after the read, so 7 has its slot when 9 arrives.
      client.send(get(5), cancel(3), malformed(7), malformed(9));
      return outcome(client, served);
    });
    assert.deepStrictEqual(result, {
      handlers: [1, 3],
      answered: [1, 3],
      resets: [
        [5, REFUSED_STREAM],
        [7, PROTOCOL_ERROR],
        [9, REFUSED_STREAM],
      ],
      goaways: [INTERNAL_ERROR],
      sessionError: "ERR_HTTP2_TOO_MANY_INVALID_FRAMES",
    });
  });

  test("a refused stream with a malformed block gets one RST_STREAM", async () => {
    const result = await withLimit(one, hold, async (client, served) => {
      client.send(get(1));
      await client.waitFor(answered(1));
      client.send(malformed(3));
      return outcome(client, served);
    });
    assert.deepStrictEqual(result, {
      handlers: [1],
      answered: [1],
      resets: refused([3]),
      goaways: [],
      sessionError: undefined,
    });
  });

  test("a refused stream is not the last stream that the session processed", async () => {
    const served: Served = { handlers: [] };
    const sessions: http2.ServerHttp2Session[] = [];
    const server = http2.createServer(one);
    server.on("session", session => sessions.push(session));
    record(server, served, hold);
    const result = await withClient(server, async client => {
      client.send(get(1));
      await client.waitFor(answered(1));
      client.send(get(3), get(5));
      await client.ping(1);
      const lastProcStreamID = sessions[0].state.lastProcStreamID;
      sessions[0].close();
      const goaway = await client.waitFor(f => f.type === GOAWAY);
      return {
        handlers: served.handlers,
        lastProcStreamID,
        goaway: [goaway?.payload.readUInt32BE(0), goaway?.payload.readUInt32BE(4)],
      };
    });
    assert.deepStrictEqual(result, { handlers: [1], lastProcStreamID: 1, goaway: [1, NO_ERROR] });
  });

  // With maxSessionInvalidFrames: 0 a second charge for stream 3 would end the session.
  test("frames on a refused stream in a later write get no answer and no charge", async () => {
    const result = await withLimit({ ...one, maxSessionInvalidFrames: 0 }, hold, async (client, served) => {
      client.send(get(1));
      await client.waitFor(answered(1));
      client.send(upload(3));
      await client.ping(1);
      client.send(frame(DATA, 0, 3, Buffer.from("hello")), frame(DATA, 0, 3));
      await client.ping(2);
      const field = Buffer.concat([Buffer.from([0x00]), literal("x-checksum"), literal("1")]);
      client.send(frame(HEADERS, END_STREAM | END_HEADERS, 3, field));
      return outcome(client, served, 3);
    });
    assert.deepStrictEqual(result, {
      handlers: [1],
      answered: [1],
      resets: refused([3]),
      goaways: [],
      sessionError: undefined,
    });
  });

  // Bun only: node accepts this respond(). A respond() that fails gives the slot back. The reset
  // or the end of that stream must not give a second slot back: 3 holds the one slot when 5 arrives.
  each(
    [
      ["the peer resets", (client: RawClient) => client.send(upload(1)), (client: RawClient) => client.send(cancel(1))],
      ["the peer has ended", (client: RawClient) => client.send(get(1)), () => {}],
    ],
    bunOnly,
  )("a stream whose respond() failed and that %s gives back one slot", async (_, open, then) => {
    const failFirst: OnStream = (stream, headers) => {
      if (stream.id === 1) stream.respond({ ":status": 200 }, { weight: 0 } as http2.ServerStreamResponseOptions);
      else hold(stream, headers);
    };
    const result = await withLimit(one, failFirst, async (client, served) => {
      open(client);
      await client.ping(1);
      then(client);
      await client.ping(2);
      client.send(get(3));
      await client.waitFor(answered(3));
      // Stream 1 gets no frame from the server, so outcome() would not return.
      client.send(get(5));
      await client.waitFor(f => f.streamId === 5 && (f.type === HEADERS || f.type === RST_STREAM));
      return seen(client, served);
    });
    assert.deepStrictEqual(result, {
      handlers: [1, 3],
      answered: [3],
      resets: refused([5]),
      goaways: [],
      sessionError: undefined,
    });
  });

  // nghttp2 closes stream 1 when it writes the trailers, after it has read every frame of the
  // chunk. So 5 is over the limit.
  each([
    [
      "a TCP socket",
      (options: http2.ServerOptions, served: Served, onStream: OnStream) => {
        const server = http2.createServer(options);
        record(server, served, onStream);
        return server;
      },
    ],
    ["a Duplex", duplexFed],
  ])("sendTrailers() on another stream keeps its slot for the rest of the read, on %s", async (_, listen) => {
    const served: Served = { handlers: [] };
    const wantsTrailers = Promise.withResolvers<void>();
    let first: http2.ServerHttp2Stream | undefined;
    const endFirst: OnStream = (stream, headers) => {
      if (stream.id === 1) {
        first = stream;
        stream.respond({ ":status": 200 }, { waitForTrailers: true });
        stream.on("wantTrailers", () => wantsTrailers.resolve());
        stream.end("hello");
        return;
      }
      if (stream.id === 3) first!.sendTrailers({ "x-checksum": "1" });
      hold(stream, headers);
    };
    const server = listen({ settings: { maxConcurrentStreams: 2 } }, served, endFirst);
    const result = await withClient(server, async client => {
      client.send(get(1));
      await wantsTrailers.promise;
      client.send(get(3), get(5));
      return outcome(client, served);
    });
    assert.deepStrictEqual(result, {
      handlers: [1, 3],
      answered: [1, 3],
      resets: refused([5]),
      goaways: [],
      sessionError: undefined,
    });
  });

  // Bun reads a top-level maxConcurrentStreams as a setting. Here `settings` overrides it with
  // no value, so no limit is sent to the peer, and none applies.
  test("a limit that was not sent to the peer refuses nothing", async () => {
    const options = { maxConcurrentStreams: 2, settings: { maxConcurrentStreams: undefined } } as http2.ServerOptions;
    assert.deepStrictEqual(await withLimit(options, hold, inOneWrite(5)), allServed(odd(5)));
  });

  describe("and maxSessionMemory", () => {
    // Node: a stream refused for memory is open until its RST_STREAM is written after the read,
    // so it uses a slot, and the requests after it are over the limit.
    test("a first flight with large responses keeps the session", async () => {
      const body = Buffer.alloc(200 * 1024, "a");
      const large: OnStream = stream => {
        stream.respond({ ":status": 200 });
        stream.write(body);
      };
      const options = { maxSessionMemory: 1, settings: { maxConcurrentStreams: 10 } };
      const result = await withLimit(options, large, inOneWrite(150));
      const memory = withCode(result.resets, ENHANCE_YOUR_CALM).length;
      assert.deepStrictEqual(
        {
          goaways: result.goaways,
          sessionError: result.sessionError,
          refusedForMemory: memory > 0,
          slots: result.handlers.length + memory,
          overTheLimit: withCode(result.resets, REFUSED_STREAM).length,
        },
        { goaways: [], sessionError: undefined, refusedForMemory: true, slots: 10, overTheLimit: 140 },
      );
    });

    test("DATA on a stream that was refused for memory gets no second RST_STREAM", async () => {
      const body = Buffer.alloc(1 << 22, "a");
      const large: OnStream = stream => {
        stream.respond({ ":status": 200 });
        stream.write(body);
      };
      const result = await withLimit({ maxSessionMemory: 1 }, large, async (client, served) => {
        client.send(get(1));
        await client.waitFor(f => f.type === DATA && f.streamId === 1);
        client.send(upload(3), frame(DATA, 0, 3, Buffer.from("hello")));
        await client.ping(1);
        client.send(frame(DATA, END_STREAM, 3, Buffer.from("world")));
        return outcome(client, served, 2);
      });
      assert.deepStrictEqual(result, {
        handlers: [1],
        answered: [1],
        resets: [[3, ENHANCE_YOUR_CALM]],
        goaways: [],
        sessionError: undefined,
      });
    });
  });

  // The listener throws in the dispatch of the reset, before the session handler has finished.
  // The child is a debug build in CI, and it needs more than the default timeout to start.
  test("an 'aborted' listener that throws does not keep the slot", { timeout: 60_000 }, async () => {
    const script = /* js */ `
      const http2 = require("node:http2");
      const net = require("node:net");
      process.on("uncaughtException", () => {});
      const handlers = [];
      const server = http2.createServer({ settings: { maxConcurrentStreams: 1 } });
      server.on("session", session => session.on("error", () => {}));
      server.on("stream", stream => {
        handlers.push(stream.id);
        stream.on("error", () => {});
        stream.on("aborted", () => {
          throw new Error("from the 'aborted' listener");
        });
        stream.respond({ ":status": 200 });
        stream.write("hello");
      });
      const frame = (type, flags, id, payload = Buffer.alloc(0)) => {
        const header = Buffer.alloc(9);
        header.writeUIntBE(payload.length, 0, 3);
        header[3] = type;
        header[4] = flags;
        header.writeUInt32BE(id, 5);
        return Buffer.concat([header, payload]);
      };
      const HEADERS = 1, RST_STREAM = 3, SETTINGS = 4;
      const upload = id => frame(HEADERS, 4, id, Buffer.from([0x83, 0x86, 0x84, 0x01, 9, ...Buffer.from("localhost")]));
      server.listen(0, "127.0.0.1", () => {
        const socket = net.connect(server.address().port, "127.0.0.1");
        socket.write(Buffer.concat([Buffer.from("PRI * HTTP/2.0\\r\\n\\r\\nSM\\r\\n\\r\\n"), frame(SETTINGS, 0, 0), upload(1)]));
        let buffered = Buffer.alloc(0);
        let resetSent = false;
        socket.on("data", chunk => {
          buffered = Buffer.concat([buffered, chunk]);
          while (buffered.length >= 9 && buffered.length >= 9 + buffered.readUIntBE(0, 3)) {
            const type = buffered[3];
            const id = buffered.readUInt32BE(5);
            buffered = buffered.subarray(9 + buffered.readUIntBE(0, 3));
            if (type === HEADERS && id === 1 && !resetSent) {
              resetSent = true;
              socket.write(Buffer.concat([frame(RST_STREAM, 0, 1, Buffer.from([0, 0, 0, 8])), upload(3)]));
            } else if ((type === HEADERS || type === RST_STREAM) && id === 3) {
              console.log(JSON.stringify({ handlers, answer: type === HEADERS ? "HEADERS" : "RST_STREAM" }));
              process.exit(0);
            }
          }
        });
      });
    `;
    const env = { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" };
    const child = spawn(process.execPath, ["-e", script], { env, stdio: ["ignore", "pipe", "pipe"] });
    const [stdout, stderr, [exitCode]] = await Promise.all([
      text(child.stdout),
      text(child.stderr),
      once(child, "close"),
    ]);
    assert.deepStrictEqual(
      { stdout: stdout.trim(), exitCode },
      {
        stdout: JSON.stringify({ handlers: [1, 3], answer: "HEADERS" }),
        exitCode: 0,
      },
    );
    assert.ok(!stderr.includes("error:"), stderr);
  });
});
