import { base } from "./dep.mjs";
export class P { #a = base; static #s = 5; #m() { return this.#a + P.#s; } get #g() { return this.#a * 2; } set #g(v) { this.#a = v; } static #sm(o) { return o.#m(); } run(n) { this.#g = n; return [this.#m(), this.#g, P.#sm(this), P.#s++].join("/"); } static has(o) { return #a in o; } }
export class Q extends P { #a = 100; both() { return this.#a + ":" + this.run(this.#a); } }
export class Auto { accessor x = 1 + base; static accessor y = 2; }
export function use() { const p = new P(), q = new Q(), a = new Auto(); a.x++; Auto.y += 3; return [p.run(3), q.both(), P.has(p), P.has(q), P.has({}), a.x, Auto.y].join(" "); }
