// A Readable, a Writable, a Duplex and a Transform are frozen, sealed or closed to new properties when they are made, while data flows, or when the data has ended.
import { Duplex, Readable, Transform, Writable } from "node:stream";

const levels = {
  freeze: (object: object) => void Object.freeze(object),
  seal: (object: object) => void Object.seal(object),
  preventExtensions: (object: object) => void Object.preventExtensions(object),
};
type Level = keyof typeof levels;
type Moment = "made" | "flowing" | "ended";

let lines: string[] = [];
const say = (...parts: unknown[]) => void lines.push(parts.map(String).join(" "));

process.on("uncaughtException", error => say("nobody caught", (error as Error)?.name, (error as Error)?.message));

function attempt(label: string, action: () => unknown) {
  try {
    const result = action();
    say(label, typeof result === "object" ? "done" : result);
  } catch (error) {
    say(label, "throws", (error as Error)?.name, (error as Error)?.message);
  }
}

function watch(stream: NodeJS.EventEmitter) {
  for (const event of ["data", "end", "finish", "close", "error", "drain", "pause", "resume"]) {
    stream.on(event, (value?: unknown) =>
      say("event", event, value instanceof Error ? `${value.name} ${value.message}` : (value ?? "")),
    );
  }
}

function describe(object: object) {
  return `${Object.isExtensible(object) ? "open" : "closed"}${Object.isSealed(object) ? " sealed" : ""}${Object.isFrozen(object) ? " frozen" : ""}`;
}

const kinds = {
  Readable: () => {
    let left = 3;
    return new Readable({
      encoding: "utf8",
      read() {
        this.push(left-- > 0 ? `chunk ${left}` : null);
      },
    });
  },
  Writable: () =>
    new Writable({
      decodeStrings: false,
      write(chunk, _encoding, callback) {
        say("written", chunk);
        callback();
      },
    }),
  Duplex: () => {
    let left = 2;
    return new Duplex({
      encoding: "utf8",
      decodeStrings: false,
      read() {
        this.push(left-- > 0 ? `chunk ${left}` : null);
      },
      write(chunk, _encoding, callback) {
        say("written", chunk);
        callback();
      },
    });
  },
  Transform: () =>
    new Transform({
      encoding: "utf8",
      transform(chunk, _encoding, callback) {
        callback(null, String(chunk).toUpperCase());
      },
    }),
};

const settle = () => new Promise(resolve => setTimeout(resolve, 2));

async function runCase(kind: keyof typeof kinds, level: Level, moment: Moment, holdsAnElement: boolean) {
  lines = [];
  const stream = kinds[kind]() as Readable & Writable;
  if (holdsAnElement) (stream as unknown as unknown[])[0] = "element";
  const close = () => {
    levels[level](stream);
    say(level, describe(stream));
  };
  if (moment === "made") close();
  attempt("watch", () => watch(stream));
  const writes = kind !== "Readable";
  if (writes) attempt("write", () => stream.write("one"));
  await settle();
  if (moment === "flowing") close();
  if (writes) {
    attempt("write", () => stream.write("two"));
    attempt("end", () => stream.end("three"));
  }
  await settle();
  if (moment === "ended") close();
  attempt("destroy", () => stream.destroy());
  await settle();
  say("destroyed", stream.destroyed, "closed", stream.closed, "errored", stream.errored?.name ?? null);
  console.log(`== ${kind} ${level} ${moment}${holdsAnElement ? " with an element" : ""}`);
  console.log(lines.join("\n"));
}

for (const kind of Object.keys(kinds) as (keyof typeof kinds)[]) {
  for (const level of Object.keys(levels) as Level[]) {
    for (const moment of ["made", "flowing", "ended"] as const) {
      await runCase(kind, level, moment, false);
      await runCase(kind, level, moment, true);
    }
  }
}
