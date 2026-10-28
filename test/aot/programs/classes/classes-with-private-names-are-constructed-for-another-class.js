// Classes with private names are constructed with another new.target, stand below built-in classes, and below functions.
const lines = [];
class Base { b = 1; }
class P extends Base { #p = 2; p() { return this.#p; } static has(o) { return #p in o; } }
class Q extends Base { #q = 3; q() { return this.#q; } }
function Old() { this.old = 4; }
class OverOld extends Old { #o = 5; o() { return this.#o + this.old; } }
class List extends Array { #n = 6; n() { return this.#n + this.length; } }
class Failure extends Error { #code = 7; code() { return this.#code; } }
class Table extends Map { #t = 8; t() { return this.#t + this.size; } }
const crossed = Reflect.construct(P, [], Q);
lines.push(crossed instanceof Q, crossed instanceof P, P.has(crossed), P.prototype.p.call(crossed));
try { lines.push(crossed.q()); } catch (error) { lines.push(error.constructor.name); }
let sum = 0; for (let i = 0; i < 300; i++) sum += new P().p() + new Q().q() + new OverOld().o() + new List(3).n() + new Failure("x").code() + new Table([[1, 2]]).t() + P.prototype.p.call(Reflect.construct(P, [], i & 1 ? Q : Base));
lines.push(sum, new List(1, 2).map((x) => x).n(), List.from([1]).n());
console.log(lines.join(" "));
