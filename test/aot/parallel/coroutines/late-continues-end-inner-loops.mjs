// Loops that continue before they suspend where a later operand of the test runs other code.
await (async () => {
const out = []; const say = (...a) => out.push(a.join(" ")); const fs = [];
const m = new Map([[3, "three"], [5, "five"], [8, "eight"]]); const list = [4, null, 2, undefined, 9, "x", 1.5]; const o = { i: 0, n: 0, get g() { say("get"); return this.i; } };
function* sub(k) { say("sub", k); if (k % 2) yield "s" + k; return k; } const tell = x => { say("t", x); return x; };
function* run(p) { try { switch (p % 3) { case 0: break; case 1: yield p; break; default: say("d"); } if (p == 6) throw new Error("six"); } catch (x) { say("caught", x && x.message); } { let v1 = -1; while (++v1 < 5) { if (p == 9 || list[p % 9] == null) continue; const c2 = m.get(v1); if (c2) say(c2); try { try { if (p == 9 || o.missing || o.n > 300) continue; else o.n += 1;  } catch (x) { say("caught", x && x.message); }  } finally { say("f"); yield v1; } } } say("end"); return o.n; }
(async () => { try {
say([...run(1)].join());
} catch (x) { say("threw", x && x.message); } say(fs.map(f => f()).join()); say(o.i, o.n); console.log(out.slice(0, 2000).join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => out.push(a.join(" ")); const fs = [];
const m = new Map([[3, "three"], [5, "five"], [8, "eight"]]); const list = [4, null, 2, undefined, 9, "x", 1.5]; const o = { i: 0, n: 0, get g() { say("get"); return this.i; } };
function* sub(k) { say("sub", k); if (k % 2) yield "s" + k; return k; } const tell = x => { say("t", x); return x; };
function* run(p) { const c1 = m.get(p); if (c1) say(c1); { let v2 = 0; L2: while (v2 < 12) { v2++; yield v2; if (tell(v2) < 2) { yield v2; } else { o.n += 1; } { let v3 = 0; while (v3++ < 2) { try { { let v4 = 0; L4: while (v4++ < 2) { try { if (p == 9 || tell(p) < 2 || p === 4) continue; else o.n += 1; if (v4 == 6) throw new Error("six"); } catch (x) { say("caught", x && x.message); } if ((v4 & 3) == 3 || o.n++ % 3 == 1 || o.n > 300) { continue; } const c5 = m.get(v4); if (c5) say(c5); fs.push(() => v4); yield v4; } } if (v3 == 6) throw new Error("six"); } finally { say("f");  } fs.push(() => v3); } } const c6 = m.get(v2); if (c6) say(c6); if (o.g > 3) { continue L2; } } } say("end"); return o.n; }
(async () => { try {
{ const g = run(3); let k = 0; for (;;) { const s = g.next(k * 10); say("step", s.value, s.done); if (s.done || ++k > 3) break; } say(JSON.stringify(g.return(7))); }
{ const g = run(3); let k = 0; for (;;) { const s = g.next(k * 10); say("step", s.value, s.done); if (s.done || ++k > 3) break; } say(JSON.stringify(g.return(7))); }
for (const x of run(2)) { say("x", x); if (out.length > 300) break; }
} catch (x) { say("threw", x && x.message); } say(fs.map(f => f()).join()); say(o.i, o.n); console.log(out.slice(0, 2000).join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => out.push(a.join(" ")); const fs = [];
const m = new Map([[3, "three"], [5, "five"], [8, "eight"]]); const list = [4, null, 2, undefined, 9, "x", 1.5]; const o = { i: 0, n: 0, get g() { say("get"); return this.i; } };
function* sub(k) { say("sub", k); if (k % 2) yield "s" + k; return k; } const tell = x => { say("t", x); return x; };
function* run(p) {  { for (let v1 = 0; v1 < 12; v1++) { if (v1 == null || m.get(v1) == null || say("last")) continue; else o.n += 1; say("sent", yield v1); yield v1; if (!p || fs[p] && fs.length > 40 || p === 4) { continue; } o.i += 1; say("i", o.i, v1); } } say("end"); return o.n; }
(async () => { try {
for (const x of run(2)) { say("x", x); if (out.length > 300) break; }
{ const g = run(1); let k = 0; for (;;) { const s = g.next(k * 10); say("step", s.value, s.done); if (s.done || ++k > 8) break; } try { say(JSON.stringify(g.throw(new Error("in")))); } catch (x) { say(x.message); } }
} catch (x) { say("threw", x && x.message); } say(fs.map(f => f()).join()); say(o.i, o.n); console.log(out.slice(0, 2000).join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => out.push(a.join(" ")); const fs = [];
const m = new Map([[3, "three"], [5, "five"], [8, "eight"]]); const list = [4, null, 2, undefined, 9, "x", 1.5]; const o = { i: 0, n: 0, get g() { say("get"); return this.i; } };
function* sub(k) { say("sub", k); if (k % 2) yield "s" + k; return k; } const tell = x => { say("t", x); return x; };
async function* run(p) { o.i += 2; say("i", o.i, p); { let v1 = -1; while (++v1 < 12) { const c2 = m.get(v1); if (c2) say(c2); if (p == 9 || tell(v1) < 2 || o.n > 300) { continue; } try { o.i += 1; say("i", o.i, v1); if (v1 == 6) throw new Error("six"); } catch (x) { say("caught", x && x.message); } { for (let v3 = 0, w = 0; v3 < 2; v3++, w = v3) { fs.push(() => v3); { for (var v4 = 0; v4 < 4; v4 += 1) { switch (v4 % 3) { case 0: continue; case 1: say(1); break; default: say("d"); } say("star", yield* sub(v4 | 0)); if (v4 === 2 || o.i > v4 || v4 === 4) continue; const c5 = m.get(v4); if (c5) say(c5); } } { let v6 = 0; while (v6 < 2) { v6++; if (v6 % 3 == 0) { say("c", v6); continue; } if (tell(v6) < 2) { say("awaited", await v6); } else { o.n += 1; } if (v6 === 2 || tell(v6) < 2 || say("last")) continue; if (false) { yield v6; } else { o.n += 1; } try { if (v6 % 3 == 0) { o.n++; break; }  } catch (x) { say("caught", x && x.message); } } } say("w", w); } } const c7 = m.get(v1); if (c7) say(c7); } } say("end"); return o.n; }
(async () => { try {
{ const g = run(2); let k = 0; for (;;) { const s = await g.next(k * 10); say("step", s.value, s.done); if (s.done || ++k > 8) break; } try { say(JSON.stringify(await g.throw(new Error("in")))); } catch (x) { say(x.message); } }
for await (const x of run(2)) { say("x", x); if (out.length > 300) break; }
} catch (x) { say("threw", x && x.message); } say(fs.map(f => f()).join()); say(o.i, o.n); console.log(out.slice(0, 2000).join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => out.push(a.join(" ")); const fs = [];
const m = new Map([[3, "three"], [5, "five"], [8, "eight"]]); const list = [4, null, 2, undefined, 9, "x", 1.5]; const o = { i: 0, n: 0, get g() { say("get"); return this.i; } };
function* sub(k) { say("sub", k); if (k % 2) yield "s" + k; return k; } const tell = x => { say("t", x); return x; };
function* run(p) {  { let v1 = 0; while (v1 < 12) { v1++; const c2 = m.get(v1); if (c2) say(c2); if (!(v1 & 1)) { say("c", v1); continue; } say("sent", yield v1); if (v1 == null || tell(v1) < 2) continue; } } say("end"); return o.n; }
(async () => { try {
{ const g = run(1); let k = 0; for (;;) { const s = g.next(k * 10); say("step", s.value, s.done); if (s.done || ++k > 8) break; }  }
} catch (x) { say("threw", x && x.message); } say(fs.map(f => f()).join()); say(o.i, o.n); console.log(out.slice(0, 2000).join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => out.push(a.join(" ")); const fs = [];
const m = new Map([[3, "three"], [5, "five"], [8, "eight"]]); const list = [4, null, 2, undefined, 9, "x", 1.5]; const o = { i: 0, n: 0, get g() { say("get"); return this.i; } };
function* sub(k) { say("sub", k); if (k % 2) yield "s" + k; return k; } const tell = x => { say("t", x); return x; };
async function run(p) {  { L1: for (let v1 = 0; v1 < 5; v1++) { if (v1 > 60 || o.missing || v1 === 4) continue; else o.n += 1; o.i += 1; say("i", o.i, v1); if (v1 > 60 || o.i > v1 || o.n > 300) continue; else o.n += 1; if (v1 > 50) { say("awaited", await v1); } else { o.n += 1; } const c2 = m.get(v1); if (c2) say(c2); } } say("end"); return o.n; }
(async () => { try {
try { say("result", await run(4)); } catch (x) { say("rejected", x.message); }
} catch (x) { say("threw", x && x.message); } say(fs.map(f => f()).join()); say(o.i, o.n); console.log(out.slice(0, 2000).join("\n")); })();
})();
