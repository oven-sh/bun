// Replaces each member that node:stream calls on a stream with a value that is not a function, uses the stream, and prints what is thrown or emitted.
// MESSAGES=whole prints each message whole. Otherwise it is printed without the text of the call, and what was called by its last name alone.
const stream = require("node:stream");
const { EventEmitter } = require("node:events");
const lines = [];
const makers = {
  Readable: () => new stream.Readable({ read() {} }),
  ReadableBare: () => new stream.Readable(),
  Writable: () =>
    new stream.Writable({
      write(chunk, encoding, callback) {
        callback();
      },
    }),
  WritableBare: () => new stream.Writable(),
  Duplex: () =>
    new stream.Duplex({
      read() {},
      write(chunk, encoding, callback) {
        callback();
      },
    }),
  Transform: () =>
    new stream.Transform({
      transform(chunk, encoding, callback) {
        callback(null, chunk);
      },
    }),
  TransformBare: () => new stream.Transform(),
  PassThrough: () => new stream.PassThrough(),
};
const members = [
  "_read",
  "_write",
  "_writev",
  "_final",
  "_destroy",
  "_construct",
  "_transform",
  "_flush",
  "_undestroy",
  "emit",
  "on",
  "once",
  "off",
  "addListener",
  "prependListener",
  "removeListener",
  "removeAllListeners",
  "listenerCount",
  "listeners",
  "push",
  "unshift",
  "read",
  "write",
  "end",
  "destroy",
  "pause",
  "resume",
  "pipe",
  "unpipe",
  "cork",
  "uncork",
  "isPaused",
  "setEncoding",
  "wrap",
  "eventNames",
];
const scenarios = {
  read: s => s.read(),
  readZero: s => s.read(0),
  readSome: s => s.read(4),
  push: s => s.push("abcd"),
  pushThenRead: s => (s.push("abcd"), s.read()),
  pushNull: s => s.push(null),
  pushNullThenRead: s => (s.push(null), s.read()),
  unshift: s => s.unshift("ab"),
  onData: s => (s.on("data", () => {}), s.push && s.push("abcd")),
  onReadable: s => (s.on("readable", () => {}), s.push && s.push("abcd")),
  resume: s => s.resume(),
  pause: s => s.pause(),
  resumePush: s => (s.resume(), s.push("abcd")),
  write: s => s.write("abcd"),
  writeTwice: s => (s.write("ab"), s.write("cd")),
  corked: s => (s.cork(), s.write("ab"), s.write("cd"), s.uncork()),
  end: s => s.end(),
  endChunk: s => s.end("abcd"),
  writeEnd: s => (s.write("ab"), s.end()),
  destroy: s => s.destroy(),
  destroyError: s => s.destroy(new Error("given")),
  pipe: s => s.pipe(new stream.PassThrough()),
  pipeInto: s => new stream.PassThrough().pipe(s),
  pipeIntoAndWrite: s => {
    const p = new stream.PassThrough();
    p.pipe(s);
    p.write("abcd");
    p.end();
  },
  pipeAndPush: s => (s.pipe(new stream.PassThrough()), s.push("abcd"), s.push(null)),
  unpipe: s => {
    const d = new stream.PassThrough();
    s.pipe(d);
    s.unpipe(d);
  },
  iterate: s => {
    const i = stream.Readable.prototype[Symbol.asyncIterator].call(s);
    i.next().catch(e => lines.push("   later: rejects " + text(e)));
    s.push("abcd");
  },
  finished: s => stream.finished(s, () => {}),
  pipeline: s => stream.pipeline(s, new stream.PassThrough(), () => {}),
  setEncoding: s => (s.setEncoding("utf8"), s.push("abcd"), s.read()),
  wrap: s => new stream.Readable().wrap(s),
  compose: s => stream.compose(s, new stream.PassThrough()),
  addAbortSignal: s => {
    const c = new AbortController();
    stream.addAbortSignal(c.signal, s);
    c.abort();
  },
};
const shorten =
  process.env.MESSAGES === "whole"
    ? message => message
    : message => message.replace(/ \(In '.*$/, "").replace(/^\S*?([\w$]+) is not a function/, "$1 is not a function");
function text(e) {
  return e === null || typeof e !== "object"
    ? String(e)
    : e.name +
        (e.code !== undefined ? " " + e.code : "") +
        ": " +
        shorten(String(e.message).split("\n")[0]).slice(0, 140);
}
// One line for each thing that is said of a member, with the streams and the number of scenarios that say it.
function grouped() {
  const members = new Map();
  let said;
  for (const line of lines) {
    if (line.startsWith("   ")) {
      said.text += " |" + line.slice(2).replace(/ in \S+ \S+ \S+:/, ":");
      continue;
    }
    const [, maker, member, , rest] = /^(\S+) (\S+) (\S+): (.*)$/.exec(line);
    if (!members.has(member)) members.set(member, []);
    members.get(member).push((said = { maker, text: rest }));
  }
  const out = [];
  for (const [member, all] of members) {
    const byText = new Map();
    for (const { maker, text } of all) {
      if (!byText.has(text)) byText.set(text, new Map());
      byText.get(text).set(maker, (byText.get(text).get(maker) ?? 0) + 1);
    }
    for (const [text, makers] of byText)
      out.push(member + " [" + Array.from(makers, ([maker, count]) => maker + " " + count).join(", ") + "]: " + text);
  }
  return out;
}
let label = "";
process.on("uncaughtException", e => lines.push("   uncaught in " + label + ": " + text(e)));
process.on("unhandledRejection", e => lines.push("   unhandled in " + label + ": " + text(e)));
const only = process.argv[2];
const work = [];
for (const maker in makers)
  for (const member of members)
    for (const scenario in scenarios) for (const value of [7, undefined]) work.push([maker, member, scenario, value]);
let at = 0;
function step() {
  const until = Math.min(work.length, at + 1);
  for (; at < until; at++) {
    const [maker, member, scenario, value] = work[at];
    if (only && maker !== only) continue;
    const s = makers[maker]();
    if (typeof s[member] !== "function" && !member.startsWith("_")) continue;
    label = maker + " " + member + "=" + value + " " + scenario;
    try {
      EventEmitter.prototype.on.call(s, "error", e => lines.push("   error event: " + text(e)));
    } catch {}
    s[member] = value;
    let said;
    try {
      scenarios[scenario](s);
      said = "returns";
    } catch (e) {
      said = "throws " + text(e);
    }
    lines.push(label + ": " + said);
  }
  if (at < work.length) setImmediate(step);
  else
    setImmediate(() =>
      setImmediate(() => {
        require("node:fs").writeSync(1, grouped().join("\n") + "\n");
        process.exit(0);
      }),
    );
}
step();
