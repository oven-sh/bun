// Calls hand an instance to a method that reads one name off it. Another class answers the name by an accessor, and other values come too.
"use strict";
const out = [];
class Event { #type; constructor(type) { this.#type = type; } get type() { return this.#type; } set type(v) { this.#type = v + "!"; } get start() { return 0; } }
function Token(type, value) { this.type = type; this.value = value; this.start = 1; this.end = 2; }
Token.prototype.kind = "above";
class Scanner {
  constructor(text) { this.text = text; this.at = 0; this.listener = { onToken(token) { if (token.type !== "end") out.push("listened " + token.type); } }; }
  next() { const token = new Token(this.at < this.text.length ? "char" : "end", this.text[this.at++]); this.see(token); this.listener.onToken(new Token("made", 1)); return token; }
  see(token) { if (token.type === "end") this.ended = true; else this.last = token; return token; }
}
function Sink() { this.all = []; this.kept = null; }
Sink.prototype = {
  /** @param {UnknownToken} token */
  take(token) { if (token.type === "end") { if (this.kept) this.all.push(this.kept); this.kept = null; return this.all.length; } if (token.type === "keep") { this.kept = token; return -1; } this.all.push(token); return token.type; },
  put(token, type) { token.type = type; return token.type; },
  above(token) { return token.kind; },
  count(token) { let n = 0; for (let k = 0; k < 5; k++) if (token.type === "char") n++; return n; },
};
const run = (work) => { try { return String(work()); } catch (error) { return error.constructor.name; } };
const scanner = new Scanner("ab"), sink = new Sink();
for (let round = 0; round < 20; round++) { const token = scanner.next(); sink.take(token); sink.take(new Token("keep", round)); out.push(sink.put(new Token("put", 1), "stored"), sink.above(new Token("a", 1)), sink.count(new Token(round % 2 ? "char" : "x", 1))); }
out.push(sink.take(new Token("end")), sink.all.length, scanner.ended);
class Heir extends Token { constructor() { super("heir", 1); this.extra = 2; } }
const strange = [() => new Event("event"), () => ({ type: "char" }), () => ({}), () => null, () => undefined, () => 3, () => "char", () => [1], () => new Heir(), () => Object.freeze(new Token("char", 1)), () => Object.create(new Token("char", 1)), () => new Proxy(new Token("char", 1), { get(target, name) { out.push("trap " + String(name)); return target[name]; }, set(target, name, value) { out.push("set trap"); target[name] = value; return true; } }), () => { const t = new Token("char", 1); delete t.type; return t; }, () => Object.defineProperty(new Token("a", 1), "type", { get() { return "char"; } }), () => Object.setPrototypeOf(new Token("char", 1), null), () => Object.setPrototypeOf(new Token("char", 1), { kind: "other" }), () => function type() {}, () => Symbol("type"), () => new Map([["type", "char"]]), () => { const t = new Token("char", 1); for (let k = 0; k < 40; k++) t["name" + k] = k; return t; }];
for (let k = 0; k < strange.length; k++) for (let round = 0; round < 3; round++) out.push(k + run(() => sink.take(strange[k]())), run(() => sink.put(strange[k](), "new" + k)), run(() => sink.above(strange[k]())), run(() => sink.count(strange[k]())), run(() => scanner.see(strange[k]()) === scanner.last), run(() => scanner.listener.onToken(strange[k]())));
Token.prototype.kind = "changed"; delete Token.prototype.kind; out.push(run(() => sink.above(new Token("a", 1))));
for (const line of out) console.log(line);
