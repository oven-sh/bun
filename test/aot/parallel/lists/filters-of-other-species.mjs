// Filters of arrays whose species is their own, whose storage changes while the callback runs, and which a callback shrinks, grows or spoils.
class Sub extends Array { tag() { return "sub"; } }
class Other { constructor(n) { this.n = n; } }
const outside = v => JSON.parse("0", () => v);
const say = r => { const k = r === undefined ? "u" : Array.isArray(r) ? (r instanceof Sub ? "Sub" : Object.getPrototypeOf(r) === Array.prototype ? "Array" : "array") : r.constructor && r.constructor.name; const n = Array.isArray(r) ? r.length : "-"; return k + " " + n + " " + Object.keys(r).join() + " " + Object.keys(r).map(x => typeof r[x] === "object" && r[x] ? "o" : Object.is(r[x], -0) ? "-0" : String(r[x])).join(); };
function kept(xs, t) { const out = xs.filter((v, i) => i % 2 === t); return out; }
function calls(xs, log) { return xs.filter((v, i, all) => { log.push(i); return v !== undefined && all.length > 0; }); }
function shrinks(xs) { return xs.filter((v, i) => { if (i === 1) xs.length = 3; return true; }); }
function grows(xs) { return xs.filter((v, i) => { if (i < 3) xs.push(9); return true; }); }
function spoils(xs, how) { return xs.filter((v, i) => { if (i === 1) how(xs); return true; }); }
function throws(xs) { return xs.filter((v, i) => { if (i === 2) throw new RangeError("x"); return true; }); }
function bound(xs, me) { return xs.filter(function (v) { return this.ok && v; }, me); }
const hows = { none() { }, hole(a) { delete a[2]; }, text(a) { a[2] = "t"; }, double(a) { a[2] = 0.5; }, getter(a) { Object.defineProperty(a, 2, { get: () => 42, configurable: true, enumerable: true }); }, frozen(a) { Object.freeze(a); }, proto(a) { Object.setPrototypeOf(a, { __proto__: Array.prototype, 2: 7 }); }, sparse(a) { a[50000] = 1; }, species(a) { a.constructor = { [Symbol.species]: Other }; }, shorter(a) { a.length = 2; }, objects(a) { a[2] = { v: 1 }; } };
const makers = { ints: () => [1, 2, 3, 4, 5], doubles: () => [0.5, 1.5, 2.5, -0, NaN], mixed: () => [1, 2.5, "c", null, undefined], holes: () => [1, , 3, , 5], sub: () => Sub.from([1, 2, 3, 4]), empty: () => [], long: () => Array.from({ length: 300 }, (_, i) => i), longd: () => Array.from({ length: 300 }, (_, i) => i + 0.5), turning: () => Array.from({ length: 60 }, (_, i) => i < 30 ? i : i + 0.5), objects: () => Array.from({ length: 40 }, (_, i) => ({ v: i })),
  own: () => { const a = [1, 2, 3, 4]; a.constructor = Sub; return a; }, species: () => { const a = [1, 2, 3, 4]; a.constructor = { [Symbol.species]: Sub }; return a; }, nullSpecies: () => { const a = [1, 2, 3]; a.constructor = { [Symbol.species]: null }; return a; }, other: () => { const a = [1, 2, 3]; a.constructor = { [Symbol.species]: Other }; return a; }, bad: () => { const a = [1, 2, 3]; a.constructor = 5; return a; }, proxied: () => new Proxy([1, 2, 3, 4], {}), frozen: () => Object.freeze([1, 2, 3, 4]) };
const tryIt = f => { try { return say(f()); } catch (e) { return "threw " + e.constructor.name + " " + e.message.slice(0, 40); } };
for (let turn = 0; turn < 3; turn++) {
  for (const name in makers) {
    const make = makers[name], log = [];
    console.log(name, tryIt(() => kept(make(), turn & 1)), "|", tryIt(() => calls(make(), log)), log.length, "|", tryIt(() => shrinks(make())), "|", tryIt(() => grows(make())), "|", tryIt(() => throws(make())), "|", tryIt(() => bound(make(), { ok: 1 })));
    for (const how in hows) console.log(name, how, tryIt(() => spoils(make(), hows[how])));
  }
}
