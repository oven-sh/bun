// STATISTIC: GettersCalledByClass >= 2
// Under: --aot-harden=proof-checks: the getter that a class calls is the one that the object finds
// Under: --aot-testing=FailSpeculations: each read runs as written
// Under: --aot-testing=CheckEffectsAtRunTime: the tests of shapes write nothing and run no code of the program
// A loop reads a name that is a getter of each of seven classes, two getters in all, off what it goes through. Getters replaced, deleted, hidden, that throw and that change what the loop goes through.
"use strict";
const R = globalThis[JSON.parse('"Reflect"')]; let seen = 0, during = null;
const empty = [];
class Term { constructor(sign) { this.sign = sign; this.uses = 0; } }
class Branch extends Term { constructor(sign, ...terms) { super(sign); this.terms = terms; } get operands() { seen++; if (during) during(this); return this.terms; } }
class Atom extends Term { get operands() { return empty; } }
class Sum extends Branch { of(a) { let n = 0; for (const t of this.terms) n += t.of(a); return n; } }
class Product extends Branch { of(a) { let n = 1; for (const t of this.terms) n = (n * t.of(a)) | 0; return n; } }
class Least extends Branch { constructor(sign, ...terms) { super(sign, ...terms); this.floor = 0; } of(a) { let n = 1e9; for (const t of this.terms) n = Math.min(n, t.of(a)); return n; } }
class Choice extends Branch { of(a) { return this.terms[a % this.terms.length].of(a); } }
class Digit extends Atom { constructor(sign, n) { super(sign); this.n = n; } of() { return this.n; } }
class Letter extends Atom { constructor(sign, name) { super(sign); this.name = name; } of(a) { return a; } }
class Blank extends Atom { of() { return 0; } }
let made = 0;
function term(depth, n) {
  made++;
  switch (depth ? n % 7 : 4 + n % 3) {
    case 0: return new Sum(1, term(depth - 1, n + 1), term(depth - 1, n + 3));
    case 1: return new Product(2, term(depth - 1, n + 2), term(depth - 1, n + 4));
    case 2: return new Least(3, term(depth - 1, n + 5), term(depth - 1, n + 1), term(depth - 1, n + 6));
    case 3: return new Choice(4, term(depth - 1, n), term(depth - 1, n + 4));
    case 4: return new Digit(5, n % 10);
    case 5: return new Letter(6, "abc"[n % 3]);
    default: return new Blank(7);
  }
}
function count(list) { let n = 0; for (let i = 0; i < list.length; i++) n = (n * 3 + list[i].operands.length) | 0; return n; }
function signs(list) { let n = 0; for (const t of list) { const inner = t.operands; for (let k = 0; k < inner.length; k++) n = (n * 5 + inner[k].sign + inner[k].operands.length) | 0; n += t.sign; } return n; }
const shown = f => { try { return String(f()); } catch (e) { return e.constructor.name; } };
const list = []; for (let i = 0; i < 40; i++) list.push(term(i % 4, i));
const all = name => { let a = 0; for (let k = 0; k < 20; k++) a = (a * 7 + count(list) + signs(list)) | 0; console.log(name, a, seen); };
console.log(made, list.reduce((n, t) => (n * 3 + t.of(4)) | 0, 0)); all("as made");
Object.defineProperty(Atom.prototype, "operands", { get() { return [list[0]]; }, configurable: true }); all("replaced");
Object.defineProperty(Digit.prototype, "operands", { get() { return []; }, configurable: true }); all("hidden by a class");
delete Digit.prototype.operands; all("taken away again");
Object.defineProperty(Atom.prototype, "operands", { get() { return empty; }, configurable: true });
for (let i = 0; i < 40; i += 9) Object.defineProperty(list[i], "operands", { value: [list[1], list[2]], configurable: true }); all("hidden by objects");
for (let i = 0; i < 40; i += 9) delete list[i].operands;
during = t => { if (seen % 50 === 0) list.push(new Blank(8)); if (seen % 70 === 0 && list.length > 30) list.pop(); }; console.log("changes", shown(() => count(list)), list.length, shown(() => signs(list)), list.length); during = null;
during = t => { if (seen % 37 === 0) Object.defineProperty(Product.prototype, "operands", { get() { return [t]; }, configurable: true }); }; console.log("replaced inside", shown(() => count(list)), shown(() => signs(list))); during = null; delete Product.prototype.operands;
during = t => { if (seen % 41 === 0) throw new TypeError("stop"); }; console.log("throws", shown(() => count(list)), shown(() => signs(list))); during = null;
let traps = 0; const mixed = [list[0], { operands: [1, 2], sign: 3 }, new Proxy(list[1], { get(t, k) { traps++; return R.get(t, k); } }), list[5], Object.create(list[7])];
console.log("mixed", shown(() => count(mixed)), shown(() => signs(mixed.slice(2))), traps);
for (const o of ["text", 5, null, undefined, {}, [list[0]]]) console.log(shown(() => count([list[2], o])), shown(() => signs([o])));
R.setPrototypeOf(Blank.prototype, Branch.prototype); console.log("another prototype", shown(() => count(list)), shown(() => signs(list)));
