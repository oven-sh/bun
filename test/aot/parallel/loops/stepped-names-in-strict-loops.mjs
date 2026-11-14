// The same in strict code.
(() => {
const out = []; const say = (...a) => { out.push(a.map(x => Object.is(x, -0) ? "-0" : typeof x === "bigint" ? x + "n" : String(x)).join(" ")); if (out.length > 400) throw new Error("enough"); };
const list = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]; const m = new Map([[2, "two"], [5, "five"], [8, "eight"], [0.5, "half"], [2147483648, "big"], [-0, "zero"]]);
class H { constructor(n) { this.a = 1; this.n = n; this.limit = 0; this.seen = 0; } fail(t) { throw new RangeError(t + this.seen); } check(c, t) { if (!c) this.fail(t); } } const make = n => new H(n);
function walk(o, limit, other) { let total = 0; for (let round = 0; round < 1; round++) { let turns = 0; while (o.n != limit) { if (++turns > 12) break; o.check(o.n <= 1e9, "bound "); const got = m.get(++o.n); if (!got) continue; say("g", got); total += turns; } say("round", round, o.n, o.seen); o.n = 1.5; } return total; }
try { const o = make(2147483645); say("total", walk(o, 2147483647, o)); say(o.n, o.seen); } catch (x) { say("threw", x && x.name, x && x.message && x.message.slice(0, 40)); }
try { const o = make(-3); say("total", walk(o, 9.5, make(1))); say(o.n, o.seen); } catch (x) { say("threw", x && x.name, x && x.message && x.message.slice(0, 40)); }
try { const o = make(3n); say("total", walk(o, 2 ** 53, o)); say(o.n, o.seen); } catch (x) { say("threw", x && x.name, x && x.message && x.message.slice(0, 40)); }
try { const o = make(2147483645); say("total", walk(o, -1, make(0.5))); say(o.n, o.seen); } catch (x) { say("threw", x && x.name, x && x.message && x.message.slice(0, 40)); }
console.log(out.slice(0, 450).join("\n"));
})();
(() => {
const out = []; const say = (...a) => { out.push(a.map(x => Object.is(x, -0) ? "-0" : typeof x === "bigint" ? x + "n" : String(x)).join(" ")); if (out.length > 400) throw new Error("enough"); };
const list = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]; const m = new Map([[2, "two"], [5, "five"], [8, "eight"], [0.5, "half"], [2147483648, "big"], [-0, "zero"]]);
const make = n => ({ a: 1, n, limit: 0, seen: 0, fail(t) { throw new RangeError(t + this.seen); }, check(c, t) { if (!c) this.fail(t); } });
function walk(o, limit, other) { let total = 0; for (let round = 0; round < 1; round++) { let turns = 0; while (limit > o.n) { if (++turns > 30) break;  o.n++; if (!m.has(o.n)) continue; say("has", o.n); total += turns; } say("round", round, o.n, o.seen); o.n = 1.5; } return total; }
try { const o = make(0); say("total", walk(o, Math.max(...[3, 17, 9]), make(1))); say(o.n, o.seen); } catch (x) { say("threw", x && x.name, x && x.message && x.message.slice(0, 40)); }
try { const o = make(1e9); say("total", walk(o, Infinity, make(1))); say(o.n, o.seen); } catch (x) { say("threw", x && x.name, x && x.message && x.message.slice(0, 40)); }
try { const o = make(3n); say("total", walk(o, "15", o)); say(o.n, o.seen); } catch (x) { say("threw", x && x.name, x && x.message && x.message.slice(0, 40)); }
try { const o = make(-2147483646); say("total", walk(o, list.length, make(0.5))); say(o.n, o.seen); } catch (x) { say("threw", x && x.name, x && x.message && x.message.slice(0, 40)); }
console.log(out.slice(0, 450).join("\n"));
})();
(() => {
const out = []; const say = (...a) => { out.push(a.map(x => Object.is(x, -0) ? "-0" : typeof x === "bigint" ? x + "n" : String(x)).join(" ")); if (out.length > 400) throw new Error("enough"); };
const list = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]; const m = new Map([[2, "two"], [5, "five"], [8, "eight"], [0.5, "half"], [2147483648, "big"], [-0, "zero"]]);
class H { constructor(n) { this.a = 1; this.n = n; this.limit = 0; this.seen = 0; } fail(t) { throw new RangeError(t + this.seen); } check(c, t) { if (!c) this.fail(t); } } const make = n => new H(n);
function walk(o, limit, other) { let total = 0; for (let round = 0; round < 2; round++) { let turns = 0; while (o.n <= limit) { if (++turns > 60) break; try { o.check(o.n < 12, "bound "); } catch (x) { say("caught", x.message); } const got = m.get(o.n++); if (!got) continue; say("g", got); total += turns; } say("round", round, o.n, o.seen); o.n = null; } return total; }
try { const o = make(3n); say("total", walk(o, 12n, make(0.5))); say(o.n, o.seen); } catch (x) { say("threw", x && x.name, x && x.message && x.message.slice(0, 40)); }
try { const o = make(1e9); say("total", walk(o, 20, make(0.5))); say(o.n, o.seen); } catch (x) { say("threw", x && x.name, x && x.message && x.message.slice(0, 40)); }
try { const o = make(2147483645); say("total", walk(o, -1, make(1))); say(o.n, o.seen); } catch (x) { say("threw", x && x.name, x && x.message && x.message.slice(0, 40)); }
try { const o = make(0); say("total", walk(o, 12n, make(0.5))); say(o.n, o.seen); } catch (x) { say("threw", x && x.name, x && x.message && x.message.slice(0, 40)); }
console.log(out.slice(0, 450).join("\n"));
})();
