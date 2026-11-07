// A hand in the library's way. Much of node's library is written twice: the text that `bun run` evaluates and a second one for a compiled executable. The two may differ only in what
// no program can tell. A program can tell a lot: what it hands to the library (options, a stream, a request, a response, the value of a header, a class of its own) may watch what it is
// asked for and answer back: throw, lay another `on`, destroy the stream, take a method away, change what is read next.
//
// A scene is put together from tables that do not know of each other: an entry point of the library with what it is handed, who of those watches, under which name, how it watches,
// and what it does when it is first asked. The scene prints whether the hand was asked at all and what came of it.
//
// How often and in which order the library reads a member is its own matter. So the hand acts at its FIRST ask alone, and `strikeWhatOnlyCounts()` takes a scene out of both prints where
// plain asked the hand and the compiled text never did. A hand that the compiled text alone asks stays in: code of the program ran that plain does not run.
//
// One hand in three does nothing and answers something else than what stood there, each time that it is asked. How often it is asked then makes no difference, so such a scene is never
// struck: a text that does not ask, where the answer counts, has not honored it.
//
// An error is told by its code, or by its message as far as the engine's own words go: "undefined is not an object (evaluating 'state.length')" quotes the text of the library,
// and the two texts are not spelled alike.

type Watched = { who: string; names: readonly string[]; members?: readonly string[]; base?: string };
type Entry = {
  imports: readonly string[];
  /** Lines that make `raw` (what the deeds work on) and whatever else the entry needs. */
  make: readonly string[];
  watched: readonly Watched[];
  /** Lines that call the library. `$raw`, `$options` and the like stand for the watched forms. `said(text)` records an answer. */
  run: readonly string[];
  /** Where the one who watches exists only from some line of `run` on: the hand is laid in front of that line. */
  layAt?: number;
  /** The options too are filled only in `run`. */
  laysOptionsAmid?: boolean;
  deeds: readonly string[];
};

const fieldsOfEmitters = ["_events", "_eventsCount", "_maxListeners"] as const;
const membersOfEmitters = ["on", "once", "emit", "removeListener", "listenerCount", "addListener", "off"] as const;
const membersOfReadables = [
  ...membersOfEmitters,
  ...["pipe", "read", "push", "resume", "pause", "destroy", "_destroy", "_read", "unpipe", "isPaused"],
  ...["destroyed", "readable", "closed", "errored", "readableEnded", "readableFlowing", "readableLength"],
] as const;
const membersOfWritables = [
  ...membersOfEmitters,
  ...["write", "end", "destroy", "_destroy", "_write", "cork", "uncork"],
  ...[
    "destroyed",
    "writable",
    "closed",
    "errored",
    "writableFinished",
    "writableEnded",
    "writableNeedDrain",
    "writableLength",
  ],
] as const;
const namesNobodyDeclares = [
  "req",
  "aborted",
  "setHeader",
  "abort",
  "_sent100",
  "_closed",
  "writableErrored",
  "readableErrored",
] as const;

const namesOfOptionsOfStreams = [
  ...["read", "write", "writev", "final", "destroy", "construct", "transform", "flush", "signal"],
  ...["highWaterMark", "objectMode", "readableObjectMode", "writableObjectMode", "readableHighWaterMark"],
  ...["encoding", "defaultEncoding", "decodeStrings", "autoDestroy", "emitClose", "allowHalfOpen"],
  ...["readable", "writable", "captureRejections"],
] as const;

const deedsOnStreams = [
  "",
  `throw new Error("from the hand");`,
  `raw.on = function (name, listener) { laid.push(String(name)); return on.call(this, name, listener); };`,
  `said("keys " + Object.keys(raw).join());`,
  `said("listeners " + raw.eventNames().map(String).join());`,
  `raw.destroy();`,
  `raw.destroy(new Error("destroyed by the hand"));`,
  `raw.pipe = undefined;`,
  `raw.write = undefined;`,
  `raw.on = undefined;`,
  `raw.pipe = () => {};`,
  `raw.write = () => true;`,
  `raw.end?.();`,
  `raw.push?.(null);`,
  `raw.resume?.();`,
  `raw._readableState = undefined;`,
  `raw._writableState = undefined;`,
  `raw.removeAllListeners();`,
  `raw.emit("error", new Error("told by the hand"));`,
  `if (other._readableState) raw._readableState = other._readableState;`,
  `if (other._writableState) raw._writableState = other._writableState;`,
  `raw._events = Object.create(null);`,
  `options.signal = AbortSignal.abort(new Error("given up"));`,
  `options.readable = false;`,
  `options.writable = false;`,
  `options.error = false;`,
] as const;

const sink = `new Writable({ write(chunk, encoding, done) { done(); } })`;
const makers: Record<string, { base: string; lines: readonly string[] }> = {
  readable: {
    base: "Readable",
    lines: [
      `new Readable({ read() {} })`,
      `new Readable({ objectMode: true, read() { this.push(null); } })`,
      `Readable.from(["a", "b"])`,
      `new Readable({ autoDestroy: false, emitClose: false, read() {} })`,
    ],
  },
  writable: {
    base: "Writable",
    lines: [sink, `new Writable({ autoDestroy: false, write(chunk, encoding, done) { done(); } })`],
  },
  duplex: {
    base: "Duplex",
    lines: [
      `new Duplex({ read() { this.push(null); }, write(chunk, encoding, done) { done(); } })`,
      `new Duplex({ autoDestroy: false, read() { this.push(null); }, write(chunk, encoding, done) { done(); } })`,
      `new PassThrough()`,
      `new Transform({ transform(chunk, encoding, done) { done(null, chunk); } })`,
    ],
  },
  request: { base: "IncomingMessage", lines: [`new IncomingMessage(new Socket())`] },
  // What passed for a stream before there were states.
  old: {
    base: "EventEmitter",
    lines: [
      `Object.assign(new EventEmitter(), { write() { return true; }, writableFinished: true })`,
      `Object.assign(new EventEmitter(), { pipe() {}, readable: true })`,
      `Object.assign(new EventEmitter(), { write() { return true; }, end() {}, pipe() {}, readable: true, writable: true })`,
    ],
  },
};
const streams = `import { Readable, Writable, Duplex, PassThrough, Transform, finished, pipeline, addAbortSignal, isReadable, isWritable, isErrored, isDisturbed } from "node:stream";`;
const emitters = `import { EventEmitter } from "node:events";`;
const requests = `import { IncomingMessage } from "node:http";\nimport { Socket } from "node:net";`;

function entriesOfStreams(pick: <T>(from: readonly T[]) => T): Entry[] {
  const kind = pick(["readable", "readable", "writable", "duplex", "duplex", "old", "request"]);
  const { base, lines } = makers[kind];
  const members =
    kind === "readable" || kind === "request"
      ? membersOfReadables
      : kind === "writable"
        ? membersOfWritables
        : kind === "old"
          ? membersOfEmitters
          : [...membersOfReadables, ...membersOfWritables];
  const fields = [
    ...fieldsOfEmitters,
    ...(kind === "old"
      ? ["write", "end", "pipe", "readable", "writable", "writableFinished", "destroyed", "closed"]
      : ["_readableState", "_writableState"]),
  ];
  const stream: Watched = { who: "raw", names: [...fields, ...members, ...namesNobodyDeclares], members, base };
  const make = [
    `let raw = ${pick(lines)};`,
    `const other = ${pick(lines)};`,
    pick([
      "",
      "other.destroy?.();",
      `other.on("error", () => {}); other.destroy?.(new Error("of the other"));`,
      "other.push?.(null); other.resume?.(); other.end?.();",
    ]),
    `const on = raw.on;`,
    `raw.on("error", error => said("error event " + words(error)));`,
    // The state in which the library finds the stream.
    pick([
      "",
      "",
      "raw.resume?.();",
      "raw.end?.();",
      "raw.push?.(null); raw.resume?.();",
      "raw.push?.(null); raw.resume?.(); raw.end?.();",
      `raw.write?.("x");`,
      `raw.push?.("x");`,
      "raw.pause?.();",
      "raw.cork?.();",
      "raw.destroy?.();",
      `raw.destroy?.(new Error("destroyed before"));`,
    ]),
    "await settle();",
  ];
  const callback = `error => said(error ? error.name + " " + words(error) : "ended")`;
  const later = pick([
    "",
    "raw.end?.();",
    "raw.push?.(null); raw.resume?.();",
    "raw.push?.(null); raw.resume?.(); raw.end?.();",
    "raw.destroy?.();",
  ]);
  const entry = (run: readonly string[], more: readonly Watched[] = []): Entry => ({
    imports: [streams, emitters, requests],
    make,
    watched: [stream, stream, ...more],
    run: [...run, later],
    deeds: deedsOnStreams,
  });
  const optionsOfFinished: Watched = { who: "options", names: ["readable", "writable", "error", "signal", "cleanup"] };
  return [
    entry([`finished($raw, $options, ${callback});`], [optionsOfFinished, optionsOfFinished]),
    entry([`finished($raw, ${callback});`]),
    entry([`said(typeof finished($raw, $options, ${callback}));`], [optionsOfFinished]),
    entry(
      kind === "writable"
        ? [`pipeline(Readable.from(["x"]), $raw, ${callback});`]
        : [`pipeline($raw, ${sink}, ${callback});`],
    ),
    entry(
      kind === "writable"
        ? [`Readable.from(["x", "y"]).pipe($raw);`]
        : [`const to = ${sink}; $raw.pipe(to); $raw.unpipe(to); said(String(raw.listenerCount("data")));`],
    ),
    entry([
      `const first = ${sink}, second = ${sink}, third = ${sink}; $raw.pipe?.(first); $raw.pipe?.(second); $raw.pipe?.(third); $raw.unpipe?.(${pick(["first", "second", "third"])}); said(String(raw._readableState?.pipes.length)); raw.push?.("a");`,
    ]),
    entry(
      kind === "writable"
        ? [`said(String($raw.write("x"))); $raw.end("y", () => said("end called back"));`]
        : [
            `(async () => { try { for await (const chunk of $raw) said("chunk " + chunk); said("loop over"); } catch (error) { said("loop threw " + words(error)); } })();`,
            `raw.push("a");`,
          ],
    ),
    entry([
      `const listener = () => said("listener ran"); $raw.on("drain", listener); $raw.once("custom", listener); $raw.removeListener("drain", listener); said(String($raw.emit("custom")));`,
    ]),
    entry([`said([$raw.destroyed, $raw.closed, $raw.errored, $raw.readable, $raw.writable].join());`]),
    entry([`said([isReadable($raw), isWritable($raw), isErrored($raw), isDisturbed($raw)].join());`]),
    entry([`$raw.destroy(); said(String(raw.destroyed));`]),
    entry([`addAbortSignal(AbortSignal.abort(new Error("stop")), $raw);`]),
    entry([`$raw.on("data", chunk => said("data " + chunk)); raw.push?.("a"); raw.write?.("b");`]),
    entry([
      `$raw.on("readable", () => { for (let chunk; (chunk = raw.read?.() ?? null) !== null; ) said("read " + chunk); }); raw.push?.("a");`,
    ]),
    entry([`said(String($raw.read?.())); raw.push?.("a"); said(String($raw.read?.()));`]),
    entry([
      `$raw.pause?.(); said(String($raw.isPaused?.())); $raw.resume?.(); said(String($raw.readableFlowing)); raw.push?.("a");`,
    ]),
    entry([`said(String($raw.push?.("a"))); said(String($raw.unshift?.("b"))); said(String(raw.readableLength));`]),
    entry([`$raw.cork?.(); said(String($raw.write?.("a"))); $raw.uncork?.(); said(String(raw.writableLength));`]),
    entry([`$raw.setEncoding?.("hex"); raw.push?.("a"); said(String($raw.read?.()));`]),
    entry([`$raw.toArray?.().then(all => said("all " + all), error => said("rejected " + words(error)));`]),
    ...[
      `new ${kind === "old" || kind === "request" ? "Readable" : base}($options)`,
      `new ${kind === "old" || kind === "request" ? "Transform" : base}($options)`,
      `Readable.from(["a", "b"], $options)`,
    ].map(
      (made): Entry => ({
        imports: [streams, emitters],
        make: [`let raw = {};`, `const other = {};`],
        watched: [
          {
            who: "options",
            names: namesOfOptionsOfStreams,
          },
        ],
        run: [
          `raw = ${made}; raw.on("error", error => said("error event " + words(error)));`,
          `said(Object.keys(raw).join()); said([raw.readableHighWaterMark, raw.writableHighWaterMark, raw.readableObjectMode, raw.writableObjectMode, raw.readable, raw.writable, raw.destroyed].join());`,
          `raw.on("data", chunk => said("data " + chunk)); raw.on("close", () => said("closed")); raw.write?.("w"); raw.end?.();`,
          later,
        ],
        deeds: [
          "",
          `throw new Error("from the hand");`,
          `options.objectMode = true;`,
          `options.highWaterMark = 0;`,
          `options.read = function () { said("another read"); this.push(null); };`,
          `options.write = (chunk, encoding, done) => { said("another write"); done(); };`,
          `options.destroy = (error, done) => { said("another destroy"); done(error); };`,
          `options.autoDestroy = false;`,
          `options.emitClose = false;`,
          `options.signal = AbortSignal.abort(new Error("given up"));`,
          `options.readable = false;`,
          `options.writable = false;`,
        ],
      }),
    ),
  ];
}

function entriesOfEvents(_pick: unknown): Entry[] {
  const imports = [`import { EventEmitter, once, getEventListeners, getMaxListeners } from "node:events";`];
  const emitter: Watched = {
    who: "raw",
    names: [...fieldsOfEmitters, ...membersOfEmitters, "domain"],
    members: membersOfEmitters,
    base: "EventEmitter",
  };
  const make = [
    `let raw = new EventEmitter();`,
    `const other = new EventEmitter();`,
    `raw.on("error", error => said("error event " + words(error)));`,
  ];
  const deeds = [
    "",
    `throw new Error("from the hand");`,
    `raw.removeAllListeners();`,
    `raw._events = Object.create(null);`,
    `raw.on("custom", () => said("laid by the hand"));`,
    `raw.emit = () => { said("another emit"); return false; };`,
    `raw.setMaxListeners(1);`,
    `options.captureRejections = true;`,
    `said("keys " + Object.keys(raw).join());`,
  ];
  const entry = (run: readonly string[], more: readonly Watched[] = []): Entry => ({
    imports,
    make,
    watched: [emitter, ...more],
    run,
    deeds,
  });
  return [
    entry([
      `const listener = () => said("listener ran"); $raw.on("custom", listener); said(String($raw.emit("custom"))); $raw.off("custom", listener); said(String($raw.listenerCount("custom")));`,
    ]),
    entry([`$raw.once("custom", value => said("once " + value)); $raw.emit("custom", 1); $raw.emit("custom", 2);`]),
    entry([
      `once($raw, "custom").then(values => said("promised " + values), error => said("rejected " + words(error))); raw.emit("custom", 3);`,
    ]),
    entry([`said(getEventListeners($raw, "error").length + " " + getMaxListeners($raw));`]),
    {
      ...entry([`EventEmitter.call(raw, $options); said(Object.keys(raw).join());`]),
      make: [`let raw = Object.create(EventEmitter.prototype);`, `const other = new EventEmitter();`],
      watched: [{ who: "options", names: ["captureRejections"] }],
    },
    entry(
      [`const made = new EventEmitter($options); said(Object.keys(made).join() + " " + made.getMaxListeners());`],
      [
        { who: "options", names: ["captureRejections"] },
        { who: "options", names: ["captureRejections"] },
      ],
    ),
  ];
}

function entriesOfHttp(pick: <T>(from: readonly T[]) => T): Entry[] {
  const imports = [
    `import { createServer, request as ask, IncomingMessage, ServerResponse } from "node:http";`,
    `import { Readable, pipeline } from "node:stream";`,
  ];
  const classes = pick([
    "",
    "",
    "",
    "{ IncomingMessage: class extends IncomingMessage {} }, ",
    "{ ServerResponse: class extends ServerResponse {} }, ",
  ]);
  const names = {
    request: [
      "_readableState",
      "_events",
      "on",
      "read",
      "destroyed",
      "readableEnded",
      "complete",
      "socket",
      "headers",
      "rawHeaders",
      "method",
      "url",
      "_destroy",
      "resume",
      "pipe",
    ],
    response: [
      "_events",
      "_header",
      "_headerSent",
      "finished",
      "destroyed",
      "sendDate",
      "statusCode",
      "statusMessage",
      "_trailer",
      "on",
      "emit",
      "write",
      "end",
      "setHeader",
      "getHeader",
      "hasHeader",
      "writeHead",
      "socket",
      "req",
      "_closed",
    ],
    socket: [
      "_events",
      "on",
      "once",
      "destroyed",
      "writable",
      "readable",
      "remoteAddress",
      "encrypted",
      "_httpMessage",
      "setTimeout",
      "destroy",
      "end",
      "write",
      "cork",
      "uncork",
      "_writableState",
      "_readableState",
    ],
  };
  const deeds = [
    "",
    `throw new Error("from the hand");`,
    `response.setHeader("x-hand", "1");`,
    `response.statusCode = 201;`,
    `response.write("w");`,
    `response.end("by the hand");`,
    `request.destroy();`,
    `response.destroy();`,
    `request.socket.destroy();`,
    `{ const on = response.on; response.on = function (name, listener) { laid.push(String(name)); return on.call(this, name, listener); }; }`,
    `response.flushHeaders();`,
  ];
  const serve = (
    handler: readonly string[],
    watched: readonly Watched[],
    body = false,
    first: readonly string[] = [],
  ): Entry => ({
    imports,
    make: [`let raw, request, response;`, `const other = {};`],
    watched,
    run: [
      `const server = createServer(${classes}(req, res) => { raw = res; request = req; response = res; try {`,
      ...first,
      ...handler,
      `} catch (error) { said("handler threw " + words(error)); if (!res.writableEnded) res.end("threw"); } });`,
      `await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));`,
      `try { const answer = await fetch("http://127.0.0.1:" + server.address().port + "/", { signal: AbortSignal.timeout(4000)${body ? `, method: "POST", body: "posted"` : ""} }); said(answer.status + " " + (answer.headers.get("x-hand") ?? "-") + " " + (answer.headers.get("x-made") ?? "-") + " " + (await answer.text())); } catch (error) { said("fetch failed"); }`,
      `server.closeAllConnections(); await new Promise(resolve => server.close(resolve));`,
    ],
    layAt: 1 + first.length,
    deeds,
  });
  const inHandler = (who: string, list: readonly string[]): Watched => ({ who, names: list });
  const send = pick([
    `$res.end("ok");`,
    `$res.write("a"); $res.end("b");`,
    `$res.writeHead(200, { "x-made": "yes" }); $res.end("ok");`,
    `$res.setHeader("x-made", "yes"); $res.end();`,
    `$res.statusCode = 202; $res.end("ok");`,
    `$res.writeHead(200, "fine"); $res.end("ok");`,
    `$res.writeHead(200, "fine", { "x-made": "yes" }); $res.end("ok");`,
  ]);
  return [
    serve([send], [inHandler("res", names.response)]),
    serve(
      [`$req.on("data", chunk => said("data " + chunk)); $req.on("end", () => res.end("read"));`],
      [inHandler("req", names.request)],
      true,
    ),
    serve(
      [
        `(async () => { let text = ""; try { for await (const chunk of $req) text += chunk; } catch (error) { text = "threw " + words(error); } if (!res.writableEnded) res.end(text); })();`,
      ],
      [inHandler("req", names.request)],
      true,
    ),
    serve(
      [`res.writeHead(200, $options); res.end("ok");`],
      [{ who: "options", names: ["x-made", "content-type", "x-other"] }],
    ),
    serve(
      [`res.setHeader("x-made", $options); res.end("ok");`],
      [{ who: "options", names: ["toString", "valueOf", "length", "0"] }],
    ),
    serve(
      [
        `said([$socket.writable, $socket.destroyed, typeof $socket.remoteAddress].join()); $socket.setTimeout(0); $socket.once("close", () => said("socket closed")); res.end("ok");`,
      ],
      [inHandler("socket", names.socket)],
      false,
      [`const socket = req.socket;`],
    ),
    serve(
      [
        `$made.setHeader("x-made", "yes"); said($made.statusCode + " " + $made.getHeader("x-made") + " " + $made.headersSent + " " + $made.writableEnded); $made.on("finish", () => said("made finished")); $made.end("z", () => said("made ended")); res.end("ok");`,
      ],
      [inHandler("made", names.response)],
      false,
      [`const made = new ServerResponse(req);`],
    ),
    ...[
      `$res.setHeader("x-made", "yes"); said([$res.getHeader("x-made"), $res.hasHeader("x-made"), JSON.stringify($res.getHeaders()), $res.getHeaderNames()].join()); $res.removeHeader("x-made"); $res.end("ok");`,
      `$res.appendHeader("x-made", "a"); $res.appendHeader("x-made", "b"); $res.end("ok");`,
      `$res.flushHeaders(); said(String($res.headersSent)); $res.end("ok");`,
      `$res.write("a", () => said("written")); $res.end("b", () => said("ended"));`,
      `$res.cork(); $res.write("a"); $res.uncork(); $res.end();`,
      `$res.setTimeout(1000, () => {}); $res.end("ok");`,
      `const tell = () => said([$res.writable, $res.writableEnded, $res.writableFinished, $res.headersSent, $res.finished, $res.destroyed, $res.closed].join()); tell(); $res.end("ok", tell); tell();`,
      `Readable.from(["a", "b"]).pipe($res);`,
      `pipeline(Readable.from(["a", "b"]), $res, error => said(error ? "pipeline " + words(error) : "pipeline over"));`,
      `$res.on("finish", () => said("finish")); $res.on("close", () => said("close")); $res.end("ok");`,
    ].map(handler => serve([handler], [inHandler("res", names.response)])),
    ...[
      `said([$req.method, $req.url, $req.httpVersion, typeof $req.headers.host, $req.complete, $req.readable, $req.destroyed, $req.aborted].join()); $req.resume(); $req.on("end", () => res.end("ok"));`,
      `$req.setEncoding("utf8"); let text = ""; $req.on("data", chunk => (text += chunk)); $req.on("end", () => res.end(text));`,
      `$req.pipe(res);`,
      `$req.on("readable", () => { for (let chunk; (chunk = req.read()) !== null; ) said("read " + chunk); }); $req.on("end", () => res.end("ok"));`,
      `$req.on("close", () => said("request closed")); $req.resume(); res.end("early");`,
    ].map(handler => serve([handler], [inHandler("req", names.request)], true)),
    {
      imports,
      make: [`let raw, request, response;`, `const other = {};`],
      watched: [
        {
          who: "options",
          names: [
            ...["host", "hostname", "port", "path", "method", "headers", "agent", "signal", "timeout", "protocol"],
            ...["auth", "setHost", "family", "lookup", "createConnection", "localAddress", "defaultPort", "socketPath"],
            ...["insecureHTTPParser", "joinDuplicateHeaders", "maxHeaderSize", "uniqueHeaders"],
          ],
        },
      ],
      run: [
        `const server = createServer((req, res) => res.end(req.method + " " + req.url + " " + (req.headers["x-hand"] ?? "-")));`,
        `await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));`,
        `Object.assign(options, { host: "127.0.0.1", port: server.address().port, path: "/first", method: "GET" });`,
        `try { await new Promise(resolve => { raw = ask($options, answer => { let text = ""; answer.on("data", chunk => (text += chunk)); answer.on("end", () => { said(answer.statusCode + " " + text); resolve(); }); }); raw.on("error", error => { said("error event " + words(error)); resolve(); }); raw.end(); setTimeout(resolve, 4000).unref(); }); } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }`,
      ],
      layAt: 3,
      laysOptionsAmid: true,
      deeds: [
        "",
        `throw new Error("from the hand");`,
        `options.path = "/other";`,
        `options.method = "POST";`,
        `options.headers = { "x-hand": "1" };`,
        `options.port = 1;`,
        `options.host = "localhost";`,
        `options.signal = AbortSignal.abort(new Error("given up"));`,
        `options.agent = false;`,
      ],
    },
  ];
}

function entriesOfFilesAndTimers(_pick: unknown): Entry[] {
  const deeds = [
    "",
    `throw new Error("from the hand");`,
    `raw.destroy?.();`,
    `options.flags = "r";`,
    `options.signal = AbortSignal.abort(new Error("given up"));`,
    `options.ref = false;`,
  ];
  return [
    {
      imports: [`import { createWriteStream } from "node:fs";`],
      make: [`let raw = {};`, `const other = {};`],
      watched: [
        {
          who: "options",
          names: [
            "flags",
            "encoding",
            "fd",
            "mode",
            "autoClose",
            "emitClose",
            "start",
            "signal",
            "highWaterMark",
            "flush",
            "fs",
          ],
        },
      ],
      run: [
        `raw = createWriteStream("/dev/null", $options); raw.on("error", error => said("error event " + error.name)); raw.end("x", () => said("written")); await closed(raw);`,
      ],
      deeds,
    },
    {
      imports: [`import { createWriteStream } from "node:fs";`],
      make: [`let raw = {};`, `const other = {};`],
      watched: [
        { who: "options", names: ["constructor", "name", "toString", "valueOf", "length", "byteLength", "buffer"] },
      ],
      run: [
        `raw = createWriteStream("/dev/null"); raw.on("error", error => said("error event " + error.name)); try { said(String(raw.write($options))); } finally { raw.destroy(); await closed(raw); }`,
      ],
      deeds,
    },
    {
      imports: [`import { createReadStream } from "node:fs";`],
      make: [`let raw = {};`, `const other = {};`],
      watched: [
        {
          who: "options",
          names: [
            "flags",
            "encoding",
            "fd",
            "mode",
            "autoClose",
            "emitClose",
            "start",
            "end",
            "signal",
            "highWaterMark",
            "fs",
          ],
        },
      ],
      run: [
        `raw = createReadStream("/dev/null", $options); raw.on("error", error => said("error event " + error.name)); raw.on("end", () => said("read to the end")); raw.resume(); await closed(raw);`,
      ],
      deeds,
    },
    {
      imports: [`import { setTimeout as sleep } from "node:timers/promises";`],
      make: [`let raw = {};`, `const other = {};`],
      watched: [{ who: "options", names: ["signal", "ref"] }],
      run: [`sleep(1, "woke", $options).then(value => said(String(value)), error => said("rejected " + error.name));`],
      deeds,
    },
    {
      imports: [],
      make: [`let raw = {};`, `const other = {};`],
      watched: [{ who: "options", names: ["valueOf", "toString"] }],
      run: [`const timer = setTimeout(() => said("fired"), $options); said(String(timer.hasRef()));`],
      deeds,
    },
  ];
}

/** Holds a draw to a part of the tables: for a build that is known to be wrong, or for the neighborhood of a mend. `scene` is asked of the whole text. */
export type OnlyTheseHands = Partial<
  Record<"entry" | "who" | "name" | "how" | "deed" | "answer" | "scene" | "world", RegExp>
>;

/** `{"entry":"finished","name":"^pipe$"}` */
function onlyTheseHands(written = "{}"): OnlyTheseHands {
  return Object.fromEntries(
    Object.entries(JSON.parse(written)).map(([table, wanted]) => [table, new RegExp(String(wanted))]),
  );
}

export function writeSceneOfAHand(
  random: () => number,
  n: number,
  isTypeScript: boolean,
  only: OnlyTheseHands = onlyTheseHands(process.env.ONLY_THESE_HANDS),
): { imports: string[]; lines: string[] } {
  for (let tries = 0; tries < 100000; tries++) {
    const scene = drawSceneOfAHand(random, n, isTypeScript, only);
    if (scene && (!only.scene || only.scene.test(scene.lines.join("\n")))) return scene;
  }
  throw new Error("the tables hold no such hand");
}

function drawSceneOfAHand(random: () => number, n: number, isTypeScript: boolean, only: OnlyTheseHands) {
  const pick = <T>(from: readonly T[]) => from[Math.floor(random() * from.length)];
  const left = (from: readonly string[], wanted?: RegExp) => (wanted ? from.filter(one => wanted.test(one)) : from);
  const family = pick([
    entriesOfStreams,
    entriesOfStreams,
    entriesOfStreams,
    entriesOfEvents,
    entriesOfHttp,
    entriesOfHttp,
    entriesOfFilesAndTimers,
  ]);
  const entry = pick(family(pick).filter(one => !only.entry || only.entry.test(one.run.join(" "))));
  const watched = entry && pick(entry.watched.filter(one => !only.who || only.who.test(one.who)));
  const name = watched && pick(left(watched.names, only.name));
  if (name === undefined) return undefined;
  const isMember = watched.members?.includes(name) ?? false;
  const inHandler = entry.layAt !== undefined && (watched.who !== "options" || entry.laysOptionsAmid === true);
  const how = pick(
    left(
      [
        "own accessor",
        "own accessor",
        "proxy",
        "link",
        ...(isMember && watched.base ? ["heir", "made by an heir", "made by an heir", "spy"] : []),
      ],
      only.how,
    ),
  );
  // A hand does something at its first ask and answers what stood there, or does nothing and answers something else for good.
  const honest = "what stood there";
  const answer = pick(
    left(
      only.deed
        ? [honest]
        : [
            ...Array<string>(16).fill(honest),
            "true",
            "false",
            "undefined",
            "null",
            "0",
            `"two\\nlines"`,
            "() => {}",
            "{}",
          ],
      only.answer,
    ),
  );
  const deed = answer === honest ? pick(left(entry.deeds, only.deed)) : "";
  if (how === undefined || deed === undefined || answer === undefined) return undefined;
  const told = (stood: string) => (answer === honest ? stood : `lies ? ${answer} : ${stood}`);
  // What is stored under the name takes the accessor's place, or is swallowed.
  const stores = pick([
    ...Array<string>(3).fill(
      `Object.defineProperty(this, ${JSON.stringify(name)}, { value, writable: true, enumerable: true, configurable: true });`,
    ),
    "",
  ]);
  const heir = `class Heir${n} extends ${watched.base} { get [${JSON.stringify(name)}]() { ask${n}(); return ${told(`super[${JSON.stringify(name)}]`)}; } set [${JSON.stringify(name)}](value) { ${stores} } }`;
  // Only what `new` makes can be made by a class below; the rest is hung below it.
  const isMadeByHeir = how === "made by an heir" && entry.make[0].startsWith(`let raw = new ${watched.base}(`);
  const key = JSON.stringify(name);
  const ask = `ask${n}()`;
  const target = watched.who === "options" ? "options" : inHandler ? watched.who : "raw";
  // What stands in the entry's text for the one who watches.
  const form =
    how === "proxy"
      ? `new Proxy(${target}, { get(held, asked, receiver) { if (asked === ${key}) ${ask}; return ${answer === honest ? "" : `lies && asked === ${key} ? ${answer} : `}Reflect.get(held, asked, receiver); } })`
      : target;
  const accessor = (held: string) =>
    `{ get() { ${ask}; return ${told(held)}; }, set(value) { ${stores} }, configurable: true, enumerable: true }`;
  const lay =
    how === "own accessor"
      ? [
          `{ const held = ${target}[${key}], hand = ${accessor("held")}; ${pick([
            `Object.defineProperty(${target}, ${key}, hand);`,
            `Object.defineProperty(${target}, ${key}, hand);`,
            `Object.defineProperties(${target}, { [${key}]: hand });`,
            `Reflect.defineProperty(${target}, ${key}, hand);`,
            `${target}.__defineGetter__(${key}, hand.get); ${target}.__defineSetter__(${key}, hand.set);`,
          ])} }`,
        ]
      : how === "link"
        ? [
            `{ const held = ${target}[${key}]; if (!Object.hasOwn(${target}, ${key})) Object.setPrototypeOf(${target}, Object.create(Object.getPrototypeOf(${target}), { [${key}]: ${accessor("held")} })); }`,
          ]
        : how === "heir" || how === "made by an heir"
          ? isMadeByHeir
            ? []
            : [`{ ${heir} Object.setPrototypeOf(raw, Heir${n}.prototype); }`]
          : how === "spy"
            ? [
                // As a test lays one: on the prototype that holds the member, for every object below it.
                `{ let holder = ${watched.base}.prototype; while (!Object.hasOwn(holder, ${key})) holder = Object.getPrototypeOf(holder); const stood = Object.getOwnPropertyDescriptor(holder, ${key}); Object.defineProperty(holder, ${key}, stood.get ? { ...stood, get() { if (this === raw) ${ask}; return ${answer === honest ? "" : `lies && this === raw ? ${answer} : `}stood.get.call(this); } } : { ...stood, value(...given) { if (this === raw) ${ask}; return ${answer === honest ? "" : `lies && this === raw ? ${answer} : `}stood.value.apply(this, given); } }); }`,
              ]
            : [];
  const fill = (line: string) =>
    line
      .replaceAll("$raw", target === "raw" ? form : "raw")
      .replaceAll("$options", target === "options" ? form : "options")
      .replaceAll("$req", target === "req" ? form : "req")
      .replaceAll("$res", target === "res" ? form : "res")
      .replaceAll("$socket", target === "socket" ? form : "socket")
      .replaceAll("$made", target === "made" ? form : "made");
  const run = entry.run.map(fill);
  if (inHandler) run.splice(entry.layAt!, 0, ...lay, `armed = lies = true;`);
  const called = entry.run[entry.layAt ?? 0]
    .replace(/^(said\(|\(async \(\) => \{ (let text = ""; )?try \{ |const \w+ = [^;]*; )+/, "")
    .slice(0, 48);
  const ignore = isTypeScript ? ["// @ts-nocheck"] : [];
  return {
    imports: [...entry.imports],
    lines: [
      ...ignore,
      `await (async () => {`,
      `  const answers = [], laid = [], options = {};`,
      `  let armed = false, fired = false, lies = false;`,
      `  const said = text => answers.push(text);`,
      `  const settle = () => new Promise(resolve => setImmediate(() => setImmediate(() => setTimeout(resolve, 5))));`,
      `  const closed = stream => new Promise(resolve => { stream.once("close", resolve); setTimeout(resolve, 3000).unref(); });`,
      `  const words = error => String(error?.code ?? error?.message ?? error).replace(/\\.? \\((evaluating|In|near) '[^]*$/, "").replace(/^[^]* is not a (function|constructor)$/, "is not a $1");`,
      `  const escaped = error => said("escaped " + words(error));`,
      `  process.on("uncaughtException", escaped).on("unhandledRejection", escaped);`,
      `  try {`,
      ...(isMadeByHeir ? [`    ${heir}`] : []),
      ...entry.make
        .filter(Boolean)
        .map(
          line =>
            "    " + (isMadeByHeir ? line.replace(`let raw = new ${watched.base}(`, `let raw = new Heir${n}(`) : line),
        ),
      `    function ${ask} { if (!armed) return; armed = false; fired = true; ${deed} }`,
      ...(inHandler ? [] : [...lay.map(line => "    " + line), `    armed = lies = true;`]),
      ...run.filter(Boolean).map(line => "    " + line),
      `  } catch (error) { said("threw " + error?.name + " " + words(error)); }`,
      `  await settle();`,
      `  armed = lies = false;`,
      `  process.off("uncaughtException", escaped).off("unhandledRejection", escaped);`,
      `  console.log(${JSON.stringify(`hand ${n}: ${watched.who} . ${name} . ${how} . ${answer === honest ? deed || "only looks" : "answers " + answer} . in ${called}`)});`,
      ...(answer === honest ? [`  console.log("~hand ${n} was asked: " + fired);`] : []),
      `  console.log("hand ${n} answers: " + answers.join(" | ") + (laid.length ? " | laid by the other on: " + laid.join() : ""));`,
      `})();`,
    ],
  };
}

/**
 * Takes out of both prints each scene whose hand plain asked and the compiled text did not: how often the library reads a member is its own matter, and a deed that hangs on a read
 * that is not made has no answer to hold. A hand that the compiled text alone asked stays: that is code of the program which plain does not run.
 */
export function strikeWhatOnlyCounts(plain: string, compiled: string): [string, string] {
  const asked = (text: string) =>
    new Map(
      [...text.matchAll(/^~hand (\d+) was asked: (true|false)$/gm)].map(found => [found[1], found[2] === "true"]),
    );
  const [byPlain, byCompiled] = [asked(plain), asked(compiled)];
  const struck = new Set(
    [...byPlain].filter(([hand, was]) => was && byCompiled.get(hand) === false).map(([hand]) => hand),
  );
  const keep = (text: string) =>
    text
      .split("\n")
      .filter(line => !struck.has(/^~?hand (\d+)[ :]/.exec(line)?.[1] ?? ""))
      .join("\n");
  return [keep(plain), keep(compiled)];
}

const membersOfBuiltIns: readonly (readonly [string, readonly string[]])[] = [
  [
    "Array.prototype",
    [
      ...["push", "pop", "shift", "unshift", "splice", "slice", "indexOf", "includes", "forEach", "map", "filter"],
      ...["join", "concat", "some", "every", "find", "findIndex", "at", "fill"],
    ],
  ],
  [
    "Object",
    [
      ...["assign", "keys", "values", "entries", "create", "defineProperty", "defineProperties", "getPrototypeOf"],
      ...["setPrototypeOf", "freeze", "hasOwn", "getOwnPropertyNames", "getOwnPropertyDescriptor"],
    ],
  ],
  ["Object.prototype", ["__proto__", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toString", "valueOf"]],
  ["Reflect", ["apply", "get", "has", "ownKeys", "defineProperty", "getPrototypeOf"]],
  [
    "String.prototype",
    ["toLowerCase", "slice", "indexOf", "charCodeAt", "trim", "split", "startsWith", "endsWith", "includes", "replace"],
  ],
  ["Number", ["isInteger", "isNaN", "isFinite", "parseInt"]],
  ["Math", ["floor", "min", "max", "ceil", "trunc"]],
  ["Map.prototype", ["get", "set", "has", "delete"]],
  ["Set.prototype", ["add", "has", "delete"]],
  ["Buffer", ["from", "concat", "byteLength", "isBuffer", "alloc", "allocUnsafe"]],
  ["Buffer.prototype", ["toString", "slice", "subarray", "copy", "write"]],
  ["process", ["nextTick", "emitWarning"]],
  ["globalThis", ["queueMicrotask"]],
  ["Symbol", ["for"]],
  ["JSON", ["stringify", "parse"]],
  ["Error", ["captureStackTrace"]],
];

/**
 * A test file. A test may do to the world what a program may not: add a name to Object.prototype, replace a member of a built-in, take one away, lay a spy on a prototype of the library.
 * It does so in front of one entry point of the library and undoes it behind. What came of it is printed behind "SEEN ", as compare-test-runs.ts reads it: the answers in one line,
 * how often a spy was called in a line of its own, so that a run which differs in a count alone can be told from one that answers otherwise.
 */
export function writeTestOfAHand(random: () => number, n: number, only: OnlyTheseHands = {}): string {
  const pick = <T>(from: readonly T[]) => from[Math.floor(random() * from.length)];
  const left = (from: readonly string[], wanted?: RegExp) => (wanted ? from.filter(one => wanted.test(one)) : from);
  for (let tries = 0; tries < 100000; tries++) {
    const family = pick([entriesOfStreams, entriesOfStreams, entriesOfEvents, entriesOfHttp, entriesOfFilesAndTimers]);
    const entry = pick(family(pick).filter(one => !only.entry || only.entry.test(one.run.join(" "))));
    if (entry === undefined) continue;
    const answer = pick(
      left(["true", "false", "undefined", "null", "0", "1", `"two\\nlines"`, "() => {}", "{}"], only.answer),
    );
    const world = pick(
      left(
        [
          ...Array<string>(3).fill("a name on Object.prototype"),
          "an accessor on Object.prototype",
          "a spy on the library",
          "a spy on the library",
          "a mock on the library",
          "a spy on a built-in",
          "a spy on a built-in",
          "a mock on a built-in",
          "a built-in loses a member",
        ],
        only.world,
      ),
    );
    if (answer === undefined || world === undefined) continue;
    const ofLibrary = pick(entry.watched.filter(one => one.base !== undefined && one.members !== undefined));
    const [holderOfBuiltIn, members] = pick(membersOfBuiltIns);
    const isOnLibrary = world.endsWith("the library");
    if (isOnLibrary && ofLibrary === undefined) continue;
    const name = pick(
      left(
        world.endsWith("Object.prototype")
          ? [...entry.watched.flatMap(one => one.names), ...namesOfOptionsOfStreams].filter(
              one => !(one in Object.prototype),
            )
          : isOnLibrary
            ? ofLibrary!.members!
            : members,
        only.name,
      ),
    );
    if (name === undefined) continue;
    const key = JSON.stringify(name);
    const holder = isOnLibrary ? `${ofLibrary!.base}.prototype` : holderOfBuiltIn;
    // A member is replaced through spyOn(), as suites do, or by a store.
    const replaced = (body: string) =>
      pick([
        `spyOn(holder, ${key}).mockImplementation(function (...given) { ${body} });`,
        `holder[${key}] = function (...given) { ${body} };`,
      ]);
    const found = `let holder = ${holder}; while (!hasOwn(holder, ${key})) holder = getPrototypeOf(holder); const stood = getOwnPropertyDescriptor(holder, ${key}); undo = () => defineProperty(holder, ${key}, stood);${world === "a built-in loses a member" ? "" : ` if (typeof stood.value !== "function") throw new Error("no method");`}`;
    const before =
      world === "a name on Object.prototype"
        ? `undo = () => delete Object.prototype[${key}]; Object.prototype[${key}] = ${answer};`
        : world === "an accessor on Object.prototype"
          ? `undo = () => delete Object.prototype[${key}]; defineProperty(Object.prototype, ${key}, { get() { calls++; return ${answer}; }, set(value) { defineProperty(this, ${key}, { value, writable: true, enumerable: true, configurable: true }); }, configurable: true });`
          : world.startsWith("a spy")
            ? `${found} ${replaced(`if (lies) calls++; return apply(stood.value, this, given);`)}`
            : world.startsWith("a mock")
              ? `${found} ${replaced(`if (!lies) return apply(stood.value, this, given); calls++; return ${pick([answer, answer, "given[0]", "this"])};`)}`
              : `${found} delete holder[${key}];`;
    const text = (line: string) => line.replace(/\$(raw|options|req|res|socket|made)\b/g, "$1");
    const title = `${world} . ${world.endsWith("Object.prototype") ? "" : holder + " . "}${name}${/^a (spy|built-in)/.test(world) ? "" : " . answers " + answer} . in ${text(entry.run[entry.layAt ?? 0]).slice(0, 60)}`;
    const lines = [
      `import { spyOn, test } from "bun:test";`,
      ...entry.imports,
      `const { apply, defineProperty, getOwnPropertyDescriptor, getPrototypeOf } = Reflect, { hasOwn } = Object, { stringify } = JSON;`,
      `test("hand ${n}", async () => {`,
      `  const answers = [], laid = [], options = {};`,
      `  let lies = false, calls = 0, undo = () => {};`,
      `  const said = text => { answers[answers.length] = text; };`,
      `  const settle = () => new Promise(resolve => setImmediate(() => setImmediate(() => setTimeout(resolve, 5))));`,
      `  const closed = stream => new Promise(resolve => { stream.once("close", resolve); setTimeout(resolve, 3000).unref(); });`,
      `  const words = error => String(error?.code ?? error?.message ?? error).replace(/\\.? \\((evaluating|In|near) '[^]*$/, "").replace(/^[^]* is not a (function|constructor)$/, "is not a $1");`,
      `  try {`,
      `    ${before}`,
      `    lies = true;`,
      ...entry.make.filter(Boolean).map(line => "    " + line),
      ...entry.run.filter(Boolean).map(line => "    " + text(line)),
      `    await settle();`,
      `  } catch (error) { lies = false; said("threw " + error?.name + " " + words(error)); } finally { lies = false; undo(); }`,
      `  console.error("SEEN hand ${n} | " + stringify([${JSON.stringify(title)}, answers, laid]));`,
      `  console.error("SEEN hand ${n} calls | " + calls);`,
      `});`,
    ];
    if (!only.scene || only.scene.test(lines.join("\n"))) return lines.join("\n") + "\n";
  }
  throw new Error("the tables hold no such test");
}

if (import.meta.main) {
  // bun write-hands.ts <seed> <how many programs> <folder> ['{"entry":"finished","name":"^pipe$"}'] [tests]: one scene a program, or one a test file.
  const [seed, count, folder] = [Number(process.argv[2] ?? 1), Number(process.argv[3] ?? 100), process.argv[4] ?? "."];
  const only = onlyTheseHands(process.argv[5]);
  let state = seed >>> 0 || 1;
  const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let n = 1; n <= count; n++) {
    if (process.argv[6] === "tests") {
      await Bun.write(`${folder}/hand-${seed}-${n}.test.js`, writeTestOfAHand(random, n, only));
      continue;
    }
    const scene = writeSceneOfAHand(random, n, false, only);
    await Bun.write(
      `${folder}/hand-${seed}-${n}.mjs`,
      [...scene.imports, ...scene.lines, "process.exit(0);"].join("\n") + "\n",
    );
  }
}
