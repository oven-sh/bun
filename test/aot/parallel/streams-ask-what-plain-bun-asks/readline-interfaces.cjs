"use strict";
// Interfaces of node:readline: their classes, members, events, iterators and what a program changes on them.
const mode = process.argv[2] ?? "as it is";
const { EventEmitter } = require("node:events");
if (mode === "emitter") EventEmitter.prototype.added = "added";
const readline = require("node:readline"), promises = require("node:readline/promises"), { Readable, Writable, PassThrough } = require("node:stream");
const say = (...parts) => console.log("#", ...parts);
const chain = object => { const names = []; for (let it = object; it && names.length < 9; it = Object.getPrototypeOf(it)) names.push(typeof it === "function" ? "f " + it.name : Object.hasOwn(it, "constructor") ? it.constructor.name : "-"); return names.join(" < "); };
for (const Class of [readline.Interface, promises.Interface]) {
  say(Class.name, Class.length, chain(Class), "|", chain(Class.prototype));
  for (let proto = Class.prototype; proto && proto !== EventEmitter.prototype; proto = Object.getPrototypeOf(proto)) say(Reflect.ownKeys(proto).map(String).join());
  const iterator = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Class.prototype), Symbol.asyncIterator) ?? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Object.getPrototypeOf(Class.prototype)), Symbol.asyncIterator);
  say(iterator && [typeof iterator.value, iterator.value.name, iterator.value.length, iterator.enumerable, iterator.writable, iterator.configurable].join());
}
if (mode === "patched") { const close = readline.Interface.prototype.close; readline.Interface.prototype.close = function (...args) { say("close asked"); return close.apply(this, args); }; Object.defineProperty(readline.Interface.prototype, "terminal", { get() { return this._terminal; }, set(value) { say("terminal", value); Object.defineProperty(this, "_terminal", { value, writable: true, configurable: true }); }, configurable: true }); }
if (mode === "base") Object.setPrototypeOf(readline.Interface.prototype, Object.assign(Object.create(Object.getPrototypeOf(readline.Interface.prototype)), { extra: "extra" }));
const show = it => Reflect.ownKeys(it).map(key => String(key) + (typeof it[key] === "object" || typeof it[key] === "function" ? "" : "=" + String(it[key]))).join();
const texts = ["one\ntwo\r\nthree", "", "\n\n", "a\rb\r\nc\n\rd", "no end", "é ü ö\n", "x\n".repeat(5), "tail\r"];
(async () => {
  for (const [title, Module] of [["callbacks", readline], ["promises", promises]]) for (const text of texts) for (const parts of [[text], [...text], [text.slice(0, 2), text.slice(2)]]) {
    const log = []; const rl = Module.createInterface({ input: Readable.from(parts.length && parts[0] !== "" ? parts : []), crlfDelay: text.length % 2 ? Infinity : 10 });
    for (const name of ["line", "close", "pause", "resume", "history", "error"]) rl.on(name, value => log.push(name + (value === undefined ? "" : " " + JSON.stringify(value))));
    await new Promise(resolve => rl.on("close", () => setImmediate(resolve)));
    say(title, JSON.stringify(text), parts.length, log.join(), rl.line, rl.closed, rl.terminal, rl.extra, rl.added);
  }
  for (const Module of [readline, promises]) {
    const rl = Module.createInterface({ input: Readable.from(["a\nb\n", "c"]), crlfDelay: Infinity }); const lines = []; for await (const line of rl) lines.push(line); say(lines.join(), show(rl));
    const early = Module.createInterface({ input: Readable.from(["a\nb\n", "c\n"]) }); for await (const line of early) { say(line); break; } say(early.closed);
  }
  const input = new PassThrough(); let written = ""; const output = new Writable({ write(chunk, _, done) { written += chunk; done(); } });
  const rl = readline.createInterface({ input, output, prompt: "? ", history: ["old"], historySize: 2, terminal: mode === "terminal" }); say(show(rl));
  rl.setPrompt("> "); rl.prompt(); rl.question("name ", answer => say("answered", answer)); input.write("me\n"); await new Promise(resolve => setImmediate(resolve)); rl.write("more"); rl.pause(); rl.resume(); say(rl.getPrompt(), rl.cursor, JSON.stringify(rl.getCursorPos())); rl.close(); say(JSON.stringify(written), rl.closed);
  try { rl.question("again", () => {}); } catch (error) { say(error.code); }
  const asked = promises.createInterface({ input: Readable.from(["yes\n"]), output }); say(await asked.question("sure ")); asked.close();
  class Own extends readline.Interface { constructor(options) { super(options); this.own = 1; } prompt() { this.own++; return super.prompt(); } }
  const own = new Own({ input: Readable.from(["q\n"]), output }); own.prompt(); await new Promise(resolve => own.on("close", resolve)); say(own.own, own instanceof readline.Interface, own instanceof EventEmitter, chain(own), Object.keys(own).join());
  say(readline.Interface({ input: Readable.from([]) }) instanceof readline.Interface, typeof rl[Symbol.dispose], typeof rl[Symbol.asyncIterator]);
  const stop = new AbortController(); const aborted = readline.createInterface({ input: new PassThrough(), signal: stop.signal }); aborted.on("close", () => say("aborted")); stop.abort();
})();
