"use strict";
const k = JSON.parse('"lay"');
class Ring { constructor(n) { this.n = n; } }
class Watched { constructor(n) { this.n = n; } }
const T = {
  count(s) { return s.length + 1; }, text(s) { return String(s); }, wrap(s) { return [s]; }, kind(s) { return typeof s; }, none(s) { return s === null; },
  lay(r, v) { r.late = v; return r; },
};
function tried(f) { try { return JSON.stringify(f()); } catch (error) { return error.constructor.name; } }
for (let i = 0; i < 4; i++) {
  console.log(tried(() => T[k](new Ring(i), i)), tried(() => T[k](Object.preventExtensions(new Ring(i)), i)), tried(() => T[k](Object.seal(new Ring(i)), i)), tried(() => T[k](Object.freeze(new Ring(i)), i)));
  console.log(tried(() => T[k](Object.freeze(T[k](new Ring(i), 1)), i)), tried(() => T[k](Object.seal(T[k](new Ring(i), 1)), i)));
  console.log(tried(() => T[k](Object.defineProperty(new Ring(i), "late", { value: 1, writable: false, configurable: true }), i)), tried(() => T[k](Object.defineProperty(new Ring(i), "late", { value: 1, writable: true, enumerable: false }), i).late));
}
const seen = [];
console.log(tried(() => T[k](new Watched(1), 1)));
Object.defineProperty(Watched.prototype, "late", { set(v) { seen.push(v); }, get() { return "got"; }, configurable: true });
console.log(tried(() => T[k](new Watched(2), 2)), T[k](new Watched(3), 3).late, seen.join());
delete Watched.prototype.late;
console.log(tried(() => T[k](new Watched(4), 4)), seen.join());
console.log(tried(() => T[k]({ n: 1 }, 2)), tried(() => T[k]([1], 2).late), tried(() => T[k](Object.create(null), 2).late), tried(() => T[k](5, 2)), tried(() => T[k](null, 2)));
