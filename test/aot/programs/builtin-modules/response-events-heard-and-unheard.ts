import { EventEmitter } from "node:events";
import { createServer, ServerResponse } from "node:http";
import type { IncomingMessage } from "node:http";
import { Stream } from "node:stream";

const lines: string[] = [];
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
type Handler = (req: IncomingMessage, res: ServerResponse) => void;
let handler: Handler = (_req, res) => void res.end("plain");

const server = createServer((req, res) => handler(req, res));
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + (server.address() as { port: number }).port;

async function ask(title: string, how: Handler) {
  lines.push("-- " + title);
  handler = how;
  for (let i = 0; i < 3; i++) {
    const answer = await (await fetch(url + "/" + i)).text();
    for (let turns = 0; turns < 4; turns++) await turn();
    lines.push("answer: " + answer);
  }
}

const names = ["socket", "prefinish", "finish", "close"];

for (let i = 0; i < 200; i++) await (await fetch(url + "/warm")).text();
await turn();

await ask("nobody listens", (_req, res) => void res.end("quiet"));

await ask("a listener for every event", (_req, res) => {
  for (const name of names) res.on(name, () => lines.push("heard " + name));
  res.end("heard");
});

await ask("two listeners for close, one once", (_req, res) => {
  res.on("close", () => lines.push("close 1, closed " + res.closed + ", destroyed " + res.destroyed));
  res.once("close", () => lines.push("close 2, listeners " + res.listenerCount("close")));
  res.end("twice");
});

await ask("a listener added by a listener", (_req, res) => {
  res.on("prefinish", () => {
    lines.push("prefinish");
    res.on("finish", () => {
      lines.push("finish");
      res.on("close", () => lines.push("close"));
    });
  });
  res.end("chain");
});

await ask("emit replaced on the response", (_req, res) => {
  const original = res.emit;
  res.emit = function (this: ServerResponse, name: string | symbol, ...rest: unknown[]) {
    lines.push("own emit " + String(name) + " " + rest.length);
    return original.call(this, name, ...rest);
  } as typeof res.emit;
  res.end("own");
});

{
  const original = ServerResponse.prototype.emit;
  ServerResponse.prototype.emit = function (this: ServerResponse, name: string | symbol, ...rest: unknown[]) {
    lines.push("class emit " + String(name) + " " + rest.length);
    return original.call(this, name, ...rest);
  } as typeof original;
  await ask("emit replaced on ServerResponse.prototype", (_req, res) => void res.end("class"));
  ServerResponse.prototype.emit = original;
}

{
  const seen: string[] = [];
  const original = EventEmitter.prototype.emit;
  EventEmitter.prototype.emit = function (this: EventEmitter, name: string | symbol, ...rest: unknown[]) {
    if (this instanceof ServerResponse) seen.push(String(name));
    return original.call(this, name, ...rest);
  } as typeof original;
  await ask("emit replaced on EventEmitter.prototype", (_req, res) => void res.end("base"));
  EventEmitter.prototype.emit = original;
  lines.push("seen: " + seen.join());
}

{
  const seen: string[] = [];
  const prototype = Stream.prototype as unknown as { emit?: typeof EventEmitter.prototype.emit };
  prototype.emit = function (this: EventEmitter, name: string | symbol, ...rest: unknown[]) {
    if (this instanceof ServerResponse) seen.push(String(name));
    return EventEmitter.prototype.emit.call(this, name, ...rest);
  };
  await ask("emit defined on Stream.prototype", (_req, res) => void res.end("stream"));
  delete prototype.emit;
  lines.push("seen: " + seen.join());
}

await ask("nobody listens again", (_req, res) => void res.end("quiet"));

await ask("the events object replaced", (_req, res) => {
  const events = Object.create(null);
  events.close = () => lines.push("close from another events object");
  (res as unknown as { _events: unknown })._events = events;
  res.end("replaced");
});

await ask("written in pieces, ended late", (_req, res) => {
  res.on("close", () => lines.push("close, finished " + res.writableFinished));
  res.write("a");
  setImmediate(() => {
    res.write("b");
    res.end("c");
  });
});

await ask("destroyed before it ends", (_req, res) => {
  res.on("close", () => lines.push("close, finished " + res.writableFinished + ", destroyed " + res.destroyed));
  res.on("finish", () => lines.push("finish"));
  res.write("part");
  setImmediate(() => res.destroy());
}).catch(error => lines.push("the client: " + (error as Error).name));
await turn();
await turn();

server.close();
await turn();
console.log(lines.join("\n"));
