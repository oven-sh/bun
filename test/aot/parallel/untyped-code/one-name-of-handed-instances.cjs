// Calls hand an instance to a method that reads one name off it. Another class answers the name by an accessor, and other values come too.
"use strict";
const out = [];
class Event { #hue; constructor(hue) { this.#hue = hue; } get hue() { return this.#hue; } set hue(v) { this.#hue = v + "!"; } get from() { return 0; } }
function Bead(hue, value) { this.till = 2; this.value = value; this.from = 1; this.hue = hue; }
Bead.prototype.kind = "above";
class Walker {
  constructor(text) { this.text = text; this.at = 0; this.listener = { hears(bead) { if (bead.hue !== "end") out.push("listened " + bead.hue); } }; }
  next() { const bead = new Bead(this.at < this.text.length ? "char" : "end", this.text[this.at++]); this.see(bead); this.listener.hears(new Bead("made", 1)); return bead; }
  see(bead) { if (bead.hue === "end") this.ended = true; else this.last = bead; return bead; }
}
function Sink() { this.all = []; this.kept = null; }
Sink.prototype = {
  /** @param {UnknownToken} bead */
  take(bead) { if (bead.hue === "end") { if (this.kept) this.all.push(this.kept); this.kept = null; return this.all.length; } if (bead.hue === "keep") { this.kept = bead; return -1; } this.all.push(bead); return bead.hue; },
  put(bead, hue) { bead.hue = hue; return bead.hue; },
  above(bead) { return bead.kind; },
  count(bead) { let n = 0; for (let k = 0; k < 5; k++) if (bead.hue === "char") n++; return n; },
};
const run = (work) => { try { return String(work()); } catch (error) { return error.constructor.name; } };
const scanner = new Walker("ab"), sink = new Sink();
for (let round = 0; round < 20; round++) { const bead = scanner.next(); sink.take(bead); sink.take(new Bead("keep", round)); out.push(sink.put(new Bead("put", 1), "stored"), sink.above(new Bead("a", 1)), sink.count(new Bead(round % 2 ? "char" : "x", 1))); }
out.push(sink.take(new Bead("end")), sink.all.length, scanner.ended);
class Heir extends Bead { constructor() { super("heir", 1); this.extra = 2; } }
const strange = [() => new Event("event"), () => ({ hue: "char" }), () => ({}), () => null, () => undefined, () => 3, () => "char", () => [1], () => new Heir(), () => Object.freeze(new Bead("char", 1)), () => Object.create(new Bead("char", 1)), () => new Proxy(new Bead("char", 1), { get(target, name) { out.push("trap " + String(name)); return target[name]; }, set(target, name, value) { out.push("set trap"); target[name] = value; return true; } }), () => { const t = new Bead("char", 1); delete t.hue; return t; }, () => Object.defineProperty(new Bead("a", 1), "hue", { get() { return "char"; } }), () => Object.setPrototypeOf(new Bead("char", 1), null), () => Object.setPrototypeOf(new Bead("char", 1), { kind: "other" }), () => function hue() {}, () => Symbol("hue"), () => new Map([["hue", "char"]]), () => { const t = new Bead("char", 1); for (let k = 0; k < 40; k++) t["name" + k] = k; return t; }];
for (let k = 0; k < strange.length; k++) for (let round = 0; round < 3; round++) out.push(k + run(() => sink.take(strange[k]())), run(() => sink.put(strange[k](), "new" + k)), run(() => sink.above(strange[k]())), run(() => sink.count(strange[k]())), run(() => scanner.see(strange[k]()) === scanner.last), run(() => scanner.listener.hears(strange[k]())));
Bead.prototype.kind = "changed"; delete Bead.prototype.kind; out.push(run(() => sink.above(new Bead("a", 1))));
for (const line of out) console.log(line);
