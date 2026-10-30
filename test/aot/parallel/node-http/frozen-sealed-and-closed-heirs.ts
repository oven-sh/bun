// Instances of classes below the request and the response, streams made by old-style constructors and responses made by hand are frozen, sealed or closed to new properties.
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Readable, Writable } from "node:stream";
import { inherits } from "node:util";

const levels = {
  freeze: (object: object) => void Object.freeze(object),
  seal: (object: object) => void Object.seal(object),
  preventExtensions: (object: object) => void Object.preventExtensions(object),
};
type Level = keyof typeof levels;
const moments = ["before", "during", "after"] as const;
type Moment = (typeof moments)[number];

let lines: string[] = [];
const say = (...parts: unknown[]) => void lines.push(parts.map(String).join(" "));

process.on("uncaughtException", error => say("nobody caught", (error as Error)?.name, (error as Error)?.message));

function attempt(label: string, action: () => unknown) {
  try {
    const result = action();
    say(label, typeof result === "object" || typeof result === "function" ? "done" : result);
  } catch (error) {
    say(label, "throws", (error as Error)?.name, (error as Error)?.message);
  }
}

function watch(label: string, emitter: NodeJS.EventEmitter, events: string[]) {
  for (const event of events) {
    emitter.on(event, (value?: unknown) =>
      say(
        label,
        event,
        value instanceof Error ? `${value.name} ${value.message}` : typeof value === "string" ? value : "",
      ),
    );
  }
}

function describe(object: object) {
  return `${Object.isExtensible(object) ? "open" : "closed"}${Object.isSealed(object) ? " sealed" : ""}${Object.isFrozen(object) ? " frozen" : ""}`;
}

const settle = (milliseconds = 2) => new Promise(resolve => setTimeout(resolve, milliseconds));

function print(title: string, answers: string[] = []) {
  console.log(`== ${title}`);
  for (const line of [...answers, ...lines]) console.log(line);
  lines = [];
}

class CountedRequest extends http.IncomingMessage {
  reads = 0;
}

class CountedResponse extends http.ServerResponse<CountedRequest> {
  writes = 0;
  label?: string;
}

async function closeInstanceOfSubclass(level: Level, target: "request" | "response", moment: Moment) {
  let turn = 0;
  const server = http.createServer(
    { IncomingMessage: CountedRequest, ServerResponse: CountedResponse },
    (request, response) => {
      const index = turn++;
      watch(`request ${index}`, request, ["close", "error", "end"]);
      watch(`response ${index}`, response, ["close", "error", "finish"]);
      const chosen = target === "request" ? request : response;
      const close = () => {
        levels[level](chosen);
        say(level, target, moment, describe(chosen));
      };
      request.resume();
      if (index === 1 && moment === "before") close();
      attempt("count", () => (request.reads++, response.writes++));
      response.write("first ");
      if (index === 1 && moment === "during") close();
      attempt("label", () => (response.label = "late"));
      response.end("last");
      if (index === 1 && moment === "after") close();
    },
  );
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address() as AddressInfo;
  const answers: string[] = [];
  for (let index = 0; index < 3; index++) {
    try {
      const answer = await fetch(`http://127.0.0.1:${port}/${index}`, {
        method: "POST",
        body: "body",
        signal: AbortSignal.timeout(20000),
      });
      answers.push(`${index}: ${answer.status} ${await answer.text()}`);
    } catch (error) {
      answers.push(`${index}: ${(error as Error)?.name}`);
    }
    await settle();
  }
  server.closeAllConnections();
  server.close();
  await settle(10);
  print(`an instance of a class below: ${level} ${target} ${moment}`, answers);
}

function OldReadable(this: Readable & { left: number }) {
  Readable.call(this, { encoding: "utf8" });
  this.left = 2;
}
inherits(OldReadable, Readable);
OldReadable.prototype._read = function (this: Readable & { left: number }) {
  this.push(this.left-- > 0 ? `chunk ${this.left}` : null);
};

class CountedWritable extends Writable {
  written = 0;
  _write(chunk: unknown, _encoding: string, callback: () => void) {
    this.written++;
    say("written", chunk);
    callback();
  }
}

async function closeStream(kind: "old-style Readable" | "class below Writable", level: Level, moment: Moment) {
  const stream: Readable | Writable =
    kind === "old-style Readable"
      ? new (OldReadable as unknown as new () => Readable)()
      : new CountedWritable({ decodeStrings: false });
  const close = () => {
    levels[level](stream);
    say(level, describe(stream));
  };
  if (moment === "before") close();
  attempt("watch", () => watch("stream", stream, ["data", "end", "finish", "close", "error"]));
  if (stream instanceof Writable) attempt("write", () => stream.write("one"));
  await settle();
  if (moment === "during") close();
  if (stream instanceof Writable) attempt("end", () => stream.end("two"));
  await settle();
  if (moment === "after") close();
  attempt("destroy", () => stream.destroy());
  await settle();
  say("destroyed", stream.destroyed, "closed", stream.closed, "errored", stream.errored?.name ?? null);
  print(`${kind}: ${level} ${moment}`);
}

async function closeResponseMadeByHand(level: Level, target: "request" | "response" | "socket", moment: Moment) {
  const request = new http.IncomingMessage(null as never);
  request.method = "GET";
  const response = new http.ServerResponse(request);
  watch("request", request, ["close", "error", "end"]);
  watch("response", response, ["close", "error", "finish"]);
  const close = () => {
    const chosen = target === "request" ? request : target === "response" ? response : response.socket;
    if (chosen == null) return say("there is no", target);
    levels[level](chosen);
    say(level, target, moment, describe(chosen));
  };
  if (moment === "before") close();
  attempt("setHeader", () => response.setHeader("x-a", "1"));
  attempt("write", () => response.write("first"));
  if (moment === "during") close();
  attempt("end", () => response.end("last"));
  await settle();
  if (moment === "after") close();
  attempt("destroy the response", () => response.destroy());
  attempt("destroy the request", () => request.destroy());
  await settle();
  say("response", response.writableEnded, response.writableFinished, response.destroyed, "request", request.destroyed);
  print(`made by hand: ${level} ${target} ${moment}`);
}

for (const level of Object.keys(levels) as Level[]) {
  for (const moment of moments) {
    for (const target of ["request", "response"] as const) await closeInstanceOfSubclass(level, target, moment);
    for (const kind of ["old-style Readable", "class below Writable"] as const) await closeStream(kind, level, moment);
    for (const target of ["request", "response", "socket"] as const)
      await closeResponseMadeByHand(level, target, moment);
  }
}
