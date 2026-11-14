// Names that inner loops step by one and compare: integers, fractions, strings, BigInts, nothing.
(() => {
const out = []; const say = (...a) => { out.push(a.map(x => Object.is(x, -0) ? "-0" : typeof x === "bigint" ? x + "n" : String(x)).join(" ")); if (out.length > 400) throw new Error("enough"); };
const list = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]; const m = new Map([[2, "two"], [5, "five"], [8, "eight"], [0.5, "half"], [2147483648, "big"], [-0, "zero"]]);
const make = n => ({ a: 1, n, limit: 0, seen: 0, fail(t) { throw new RangeError(t + this.seen); }, check(c, t) { if (!c) this.fail(t); } });
const make0 = make; const makeOdd = n => { const o = make0(n); let v = n; Object.defineProperty(o, "n", { get() { o.seen++; return v; }, set(x) { v = x; }, configurable: true }); return o; };
function walk(o, limit, other) { let total = 0; for (let round = 0; round < 1; round++) { let turns = 0; while (o.n <= limit) { if (++turns > 60) break;  say(typeof o.n, o.n); o.n++; total += turns; } say("round", round, o.n, o.seen); o.n = 0; } return total; }
try { const o = make(true); say("total", walk(o, list.length, o)); say(o.n, o.seen); } catch (x) { say("threw", x && x.name, x && x.message && x.message.slice(0, 40)); }
try { const o = make(undefined); say("total", walk(o, NaN, make(0.5))); say(o.n, o.seen); } catch (x) { say("threw", x && x.name, x && x.message && x.message.slice(0, 40)); }
try { const o = makeOdd(9007199254740990); say("total", walk(o, 2147483647, o)); say(o.n, o.seen); } catch (x) { say("threw", x && x.name, x && x.message && x.message.slice(0, 40)); }
try { const o = makeOdd(true); Object.freeze(o); say("total", walk(o, 2 ** 31, make(0.5))); say(o.n, o.seen); } catch (x) { say("threw", x && x.name, x && x.message && x.message.slice(0, 40)); }
console.log(out.slice(0, 450).join("\n"));
})();
(() => {
const out = []; const say = (...a) => { out.push(a.map(x => Object.is(x, -0) ? "-0" : typeof x === "bigint" ? x + "n" : String(x)).join(" ")); if (out.length > 400) throw new Error("enough"); };
const list = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]; const m = new Map([[2, "two"], [5, "five"], [8, "eight"], [0.5, "half"], [2147483648, "big"], [-0, "zero"]]);
const make = n => ({ a: 1, n, limit: 0, seen: 0, fail(t) { throw new RangeError(t + this.seen); }, check(c, t) { if (!c) this.fail(t); } });
function walk(o, limit, other) { let total = 0; for (let round = 0; round < 3; round++) { let turns = 0; while (o.n <= limit) { if (++turns > 12) break;  other.n = o.n; o.n += 1; say(other.n, o.n); total += turns; } say("round", round, o.n, o.seen); o.n = 1.5; } return total; }
try { const o = make({ valueOf() { say("valueOf"); return 2; } }); say("total", walk(o, NaN, make(0.5))); say(o.n, o.seen); } catch (x) { say("threw", x && x.name, x && x.message && x.message.slice(0, 40)); }
try { const o = make(undefined); Object.freeze(o); say("total", walk(o, 20, make(1))); say(o.n, o.seen); } catch (x) { say("threw", x && x.name, x && x.message && x.message.slice(0, 40)); }
try { const o = make(0); say("total", walk(o, Infinity, o)); say(o.n, o.seen); } catch (x) { say("threw", x && x.name, x && x.message && x.message.slice(0, 40)); }
console.log(out.slice(0, 450).join("\n"));
})();
(() => {
const out = []; const say = (...a) => { out.push(a.map(x => Object.is(x, -0) ? "-0" : typeof x === "bigint" ? x + "n" : String(x)).join(" ")); if (out.length > 400) throw new Error("enough"); };
const list = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]; const m = new Map([[2, "two"], [5, "five"], [8, "eight"], [0.5, "half"], [2147483648, "big"], [-0, "zero"]]);
const make = n => ({ a: 1, n, limit: 0, seen: 0, fail(t) { throw new RangeError(t + this.seen); }, check(c, t) { if (!c) this.fail(t); } });
function walk(o, limit, other) { let total = 0; for (let round = 0; round < 1; round++) { let turns = 0; while (o.n !== limit) { if (++turns > 30) break; if (o.n > 1e9) o.fail("big "); const got = m.get(o.n++); if (!got) continue; say("g", got); total += turns; } say("round", round, o.n, o.seen); o.n = 0; } return total; }
try { const o = make("3"); say("total", walk(o, 20, o)); say(o.n, o.seen); } catch (x) { say("threw", x && x.name, x && x.message && x.message.slice(0, 40)); }
try { const o = make(-2147483646); say("total", walk(o, 2147483647, make(1))); say(o.n, o.seen); } catch (x) { say("threw", x && x.name, x && x.message && x.message.slice(0, 40)); }
console.log(out.slice(0, 450).join("\n"));
})();
(() => {
const out = []; const say = (...a) => { out.push(a.map(x => Object.is(x, -0) ? "-0" : typeof x === "bigint" ? x + "n" : String(x)).join(" ")); if (out.length > 400) throw new Error("enough"); };
const list = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]; const m = new Map([[2, "two"], [5, "five"], [8, "eight"], [0.5, "half"], [2147483648, "big"], [-0, "zero"]]);
const make = n => ({ a: 1, n, limit: 0, seen: 0, fail(t) { throw new RangeError(t + this.seen); }, check(c, t) { if (!c) this.fail(t); } });
function walk(o, limit, other) { let total = 0; for (let round = 0; round < 3; round++) { let turns = 0; while (o.n !== limit) { if (++turns > 60) break; o.check(o.n <= 1e9, "bound "); o.n += 1; if (!m.has(o.n)) continue; say("has", o.n); total += turns; } say("round", round, o.n, o.seen); o.n -= 4; } return total; }
try { const o = make(0.5); say("total", walk(o, list.length, make(0.5))); say(o.n, o.seen); } catch (x) { say("threw", x && x.name, x && x.message && x.message.slice(0, 40)); }
try { const o = make(3n); say("total", walk(o, [14], make(0.5))); say(o.n, o.seen); } catch (x) { say("threw", x && x.name, x && x.message && x.message.slice(0, 40)); }
console.log(out.slice(0, 450).join("\n"));
})();
(() => {
const out = []; const say = (...a) => { out.push(a.map(x => Object.is(x, -0) ? "-0" : typeof x === "bigint" ? x + "n" : String(x)).join(" ")); if (out.length > 400) throw new Error("enough"); };
const list = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]; const m = new Map([[2, "two"], [5, "five"], [8, "eight"], [0.5, "half"], [2147483648, "big"], [-0, "zero"]]);
const proto = { fail(t) { throw new RangeError(t + this.seen); }, check(c, t) { if (!c) this.fail(t); } }; const make = n => { const o = Object.create(proto); o.n = n; o.limit = 0; o.seen = 0; return o; };
function walk(o, limit, other) { let total = 0; for (let round = 0; round < 1; round++) { let turns = 0; while (!(o.n >= limit)) { if (++turns > 60) break;  const got = m.get(o.n++); if (!got) continue; say("g", got); total += turns; } say("round", round, o.n, o.seen); o.n = 1.5; } return total; }
try { const o = make(0); say("total", walk(o, Infinity, o)); say(o.n, o.seen); } catch (x) { say("threw", x && x.name, x && x.message && x.message.slice(0, 40)); }
try { const o = make(null); Object.freeze(o); say("total", walk(o, 9.5, make(0.5))); say(o.n, o.seen); } catch (x) { say("threw", x && x.name, x && x.message && x.message.slice(0, 40)); }
try { const o = make(0); say("total", walk(o, Infinity, make(0.5))); say(o.n, o.seen); } catch (x) { say("threw", x && x.name, x && x.message && x.message.slice(0, 40)); }
try { const o = make("3"); say("total", walk(o, 2 ** 53, make(0.5))); say(o.n, o.seen); } catch (x) { say("threw", x && x.name, x && x.message && x.message.slice(0, 40)); }
console.log(out.slice(0, 450).join("\n"));
})();
