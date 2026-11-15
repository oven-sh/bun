const unseen = x => [x][JSON.parse("0")];
import { EventEmitter } from "node:events"; const mix = P => class extends P { on(n, f) { this.c = (this.c ?? 0) + 1; return super.on(n, f); } }; const P0 = mix(EventEmitter), P1 = EventEmitter, P2 = class extends EventEmitter {}; const take = f => make(f, ...[]), show = g => g.on("a", () => {}).listenerCount("a") + String(g.c);
function make(C, ...a) { return new C(a[0]); }
function apply(f, ...a) { return f(a[0]); }
function run(n) { let out = ""; for (let i = 0; i < n; i++) { try { let f; switch (i % 3) { case 0: f = P0; break; case 1: f = P1; break; default: f = P2; } const got = take(f, i); out += show(got, i) + ";"; } catch (e) { out += e.constructor.name + ";"; } } return out; }
for (const n of unseen([3])) console.log(run(n));
