// Under: --aot-harden=proof-checks: a store that leans on what the run time said of everything above the object (K2.prototype.x is a value) had the guard of the name asked again, which the value has changed
const log = [];
const tryTo = f => { try { return f(); } catch (e) { log.push(e.name); } };
class K1 { constructor(p, q) { this.c = undefined; } }
class K2 extends K1 { constructor(p, q) { super(p, q); this.y = 7; this.a = p + 1; this.b = q; if (p & 1) this.x = undefined; } }
(function () { K2.prototype.x = 5; })();
const say = o => Object.keys(o).join() + " " + o.x;
function use2() { tryTo(() => { for (let j = 0; j < 4; j++) { const o = new K2(j, j + 1); log.push(say(o)); } }); }
tryTo(() => { class H extends K2 { constructor(p) { super(p, 1); } } for (let j = 0; j < 3; j++) { const o = new H(j); log.push(say(o)); } });
use2();
const define = JSON.parse("0", () => Object.defineProperty);
define(K2.prototype, "x", { set(v) { log.push("set " + v); }, get() { return "got"; }, configurable: true });
use2();
define(K2.prototype, "x", { value: 3, writable: false, configurable: true });
use2();
delete K2.prototype.x;
use2();
console.log(log.join("\n"));
