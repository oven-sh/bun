// The own keys of a request of node:http from its start to its close, its signal, its headers once they are built, replaced or emptied, and where a response takes its lenient header validation from.
import { createServer, IncomingMessage, OutgoingMessage } from "node:http";
import type { ServerResponse } from "node:http";

const lines: string[] = [];
type Handler = (req: IncomingMessage, res: ServerResponse) => void;
type Options = { httpValidation?: string; insecureHTTPParser?: boolean };
let handler: Handler = (_req, res) => void res.end("plain");
let atTheEnd: ((req: IncomingMessage) => void) | undefined;
let settle = () => {};

const server = createServer((req, res) => {
  handler(req, res);
  res.on("close", () =>
    setImmediate(() => {
      atTheEnd?.(req);
      settle();
    }),
  );
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + (server.address() as { port: number }).port;

function keysOf(object: object) {
  return Reflect.ownKeys(object)
    .map(key => (typeof key === "symbol" ? String(key) + (Symbol.keyFor(key) === undefined ? "" : " registered") : key))
    .join(" ");
}

async function ask(title: string, how: Handler, init?: RequestInit, last?: (req: IncomingMessage) => void) {
  lines.push("-- " + title);
  handler = how;
  atTheEnd = last;
  for (let i = 0; i < 2; i++) {
    const settled = new Promise<void>(resolve => void (settle = resolve));
    const response = await fetch(url + "/" + i, init);
    const answer = await response.text();
    await settled;
    lines.push("answer: " + response.status + " " + answer);
  }
}

await ask("two hundred requests first", (_req, res) => void res.end("warm"));
for (let i = 0; i < 200; i++) {
  const settled = new Promise<void>(resolve => void (settle = resolve));
  await (await fetch(url + "/warm")).text();
  await settled;
}

lines.push("length " + IncomingMessage.length + " " + OutgoingMessage.length);
lines.push("made by hand: " + keysOf(new IncomingMessage(null as never)));

await ask(
  "the own keys of a request without a body",
  (req, res) => {
    lines.push("at the start: " + keysOf(req));
    res.end("keys");
  },
  undefined,
  req => lines.push("behind the close: " + keysOf(req)),
);

await ask(
  "the own keys of a request with a body",
  (req, res) => {
    lines.push("at the start: " + keysOf(req));
    let length = 0;
    req.on("data", chunk => void (length += chunk.length));
    req.on("end", () => res.end("read " + length));
  },
  { method: "POST", body: "twelve bytes" },
  req => lines.push("behind the close: " + keysOf(req)),
);

await ask("the signal of a request", (req, res) => {
  const signal = req.signal;
  const registered = (req as unknown as Record<symbol, unknown>)[Symbol.for("kAbortController")];
  lines.push("one signal " + (signal === req.signal) + ", aborted " + signal.aborted + ", under a registered key " + String(registered));
  signal.addEventListener("abort", () => lines.push("abort, destroyed " + req.destroyed));
  res.end("signal");
});

await ask(
  "the signal of a request that is closed already",
  (_req, res) => void res.end("late"),
  undefined,
  req => lines.push("asked late, aborted " + req.signal.aborted),
);

await ask("headers that are read, replaced and emptied", (req, res) => {
  const first = req.headers;
  lines.push("the same object " + (first === req.headers) + ", host " + (first.host === new URL(url).host));
  const mine = { mine: "1" };
  req.headers = mine;
  lines.push("mine " + (req.headers === mine));
  const callable: unknown = () => {};
  req.headers = callable as never;
  lines.push("a function " + ((req.headers as unknown) === callable));
  for (const empty of [null, undefined, 0, "", false]) {
    req.headers = empty as never;
    const built = req.headers;
    lines.push("behind " + String(empty) + ": " + typeof built + " " + (built === first) + " " + Object.keys(built).sort().join());
  }
  res.end("headers");
});

function tryOddHeader(res: ServerResponse) {
  try {
    res.setHeader("X-Odd", "a\u0001b");
    res.removeHeader("X-Odd");
    return "taken";
  } catch (error) {
    return (error as { code: string }).code;
  }
}

await ask("a strict response", (_req, res) => void res.end(tryOddHeader(res)));

await ask("a response with an option of its own", (_req, res) => {
  (res as unknown as Options).httpValidation = "relaxed";
  res.end(tryOddHeader(res));
});

await ask("the answer is kept for the life of the response", (_req, res) => {
  const before = tryOddHeader(res);
  (res as unknown as Options).insecureHTTPParser = true;
  res.end(before + " " + tryOddHeader(res));
});

(server as unknown as Options).insecureHTTPParser = true;
await ask("the server turns lenient between two requests", (_req, res) => void res.end(tryOddHeader(res)));

(server as unknown as Options).httpValidation = "strict";
await ask("the newer option of the server comes first", (_req, res) => void res.end(tryOddHeader(res)));

await ask("the option of the response comes before the server's", (_req, res) => {
  (res as unknown as Options).httpValidation = "insecure";
  res.end(tryOddHeader(res));
});

const alone = new OutgoingMessage();
lines.push("a message without a request: " + (alone as unknown as { _isLenientHeaderValidation(): boolean })._isLenientHeaderValidation());

server.close();
console.log(lines.join("\n"));
