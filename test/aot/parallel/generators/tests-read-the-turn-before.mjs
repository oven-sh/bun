// What a generator assigns behind a yield and compares with what it was: the test reads the turn before, what is yielded reads the new turn.
const show = v => Object.is(v, -0) ? "-0" : typeof v === "number" ? "" + v : typeof v + ":" + String(v);
const log = [];
function* doWhile(n, h) { let s = n, u; do { yield s; u = s; s = s + h; } while (s <= u); return s; }
function* doWhileDoubles() { let s = 0.5, u; do { yield s; u = s; s = s + 1; } while (s <= u); return s; }
function* doWhileUp() { let s = 0.5, u, k = 0; do { yield s; u = s; s = s + 0.5; } while (s > u); return k; }
function* doWhileIntegers() { let s = 0, u; do { yield s; u = s; s = s + 1; } while (s <= u); return s; }
function* doWhileIntegersUp() { let s = 0, u; do { yield u === undefined ? -1 : u; u = s; s++; } while (s >= u + 1); return s; }
function* whileDoubles() { let s = 0.5, u = 9.5; while (s <= u) { yield s; u = s; s = s + 1; } return s + u; }
function* whileFall() { let s = 8.5, u = 9.5; while (s < u) { yield s; u = s; s = s - 1.5; } return s + u; }
function* forDoubles() { let u = 9.5; for (let s = 0.5; s <= u; s += 1) { yield s; u = s + 0.75; } return u; }
function* forSwapped() { let u = -9.5; for (let s = 0.5; u < s; s += 1) { yield s; u = s; } return u; }
function* swap(n, h) { let a = n, b = h, k = 0; do { yield a; const t = a; a = b; b = t; } while (a > b || k++ < 4); return a - b; }
function* swapDoubles() { let a = 0.5, b = 2.5; do { yield a; const t = a; a = b; b = t; } while (a > b); return a - b; }
function* three() { let a = 0.5, b = 1.5, c = 2.5; for (let i = 0; i < 8; i++) { yield a; const t = a; a = b; b = c; c = t; if (a === c) return "same"; } return a + b * 10 + c * 100; }
function* chain(n) { let a = n, b = 0.5, c = 0.25; while (c < 12) { yield b; c = b; b = a; a = a + 1; if (a <= b) return "fell"; } return a; }
function* sentSum(n) { let s = n, u; do { const x = yield s; u = s; s = s + x; } while (s >= u); return s; }
function* sentOld(n) { let s = n, u = 0; while (u <= s) { const x = yield u; u = s; s = x; } return u - s; }
function* atEnd(n, h) { let s = n, u = 0.5; for (;;) { yield s; u = s; s = s + h; if (s <= u) continue; if (s > 6) break; } return s - u; }
function* delegated() { yield* doWhileDoubles(); const r = yield* whileFall(); yield r; return r; }
function* tried() { let s = 0.5, u; do { try { yield s; } finally { log.push("f"); } u = s; s = s + 1; } while (s <= u); return s; }
function* triedAround() { let s = 8.5, u = 9.5; try { while (s < u) { yield s; u = s; s = s - 1.5; } } finally { log.push(s); } return u; }
function drive(g, sends) { const s = []; let k = 0, x; while (k < 18) { x = g.next(sends[k++ % sends.length]); s.push(show(x.value)); if (x.done) break; } if (!x.done) s.push(show(g.return(7).value)); return s.join(); }
function over(g) { const s = []; for (const x of g) { s.push(show(x)); if (s.length > 14) break; } return s.join(); }
function* pulled(g) { let k = 0; for (const x of g) { yield x; if (++k > 10) return k; } }
const G = { doWhile, doWhileDoubles, doWhileUp, doWhileIntegers, doWhileIntegersUp, whileDoubles, whileFall, forDoubles, forSwapped, swap, swapDoubles, three, chain, sentSum, sentOld, atEnd, delegated, tried, triedAround };
globalThis.G = G;
for (const k of Object.keys(G)) for (const a of [[0.5, 1], [1, -0.5], [3, 2], [2.5, 0.25], [-0, -0], [4, NaN]]) console.log(k, a.join(), drive(G[k](...a), [1, 0.5, 2]), drive(G[k](...a), [1, -1, 3, "t"]), over(G[k](...a)), [...pulled(G[k](...a))].join());
async function* asyncDoWhile() { let s = 0.5, u; do { yield s; u = s; s = s + 1; } while (s <= u); return s; }
async function* asyncWhile() { let s = 8.5, u = 9.5; while (s < u) { yield s; u = s; s = s - 1.5; } return s; }
async function* asyncAwaits() { let s = 0.5, u = 9.5; while (s <= u) { u = s; yield s; s = s + (await 1); if (s <= u) return "fell"; if (s > 5) return u; } }
globalThis.A = { asyncDoWhile, asyncWhile, asyncAwaits };
for (const k of Object.keys(globalThis.A)) { const s = []; for await (const x of globalThis.A[k]()) { s.push(show(x)); if (s.length > 12) break; } console.log(k, s.join()); }
console.log(log.length);
