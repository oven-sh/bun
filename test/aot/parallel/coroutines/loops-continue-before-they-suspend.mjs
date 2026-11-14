// Loops of generators and async functions whose iterations may continue before the body suspends.
await (async () => {
const out = []; const say = (...a) => out.push(a.join(" ")); const fs = [];
const m = new Map([[3, "three"], [5, "five"], [8, "eight"]]); const list = [4, null, 2, undefined, 9, "x", 1.5]; const o = { i: 0, n: 0, get g() { say("get"); return this.i; } };
function* sub(k) { say("sub", k); if (k % 2) yield "s" + k; return k; } const tell = x => { say("t", x); return x; };
async function run(p) {  { let v1 = 0; while (v1++ < 5) { if (o.i > v1) { continue; } switch (v1 % 3) { case 0: break; case 1: say(1); break; default: say("d"); } await tell(v1); await tell(v1); } } say("end"); return o.n; }
await (async () => { try {
try { say("result", await run(1)); } catch (x) { say("rejected", x.message); }
} catch (x) { say("threw", x && x.message); } say(fs.map(f => f()).join()); say(o.i, o.n); console.log(out.slice(0, 2000).join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => out.push(a.join(" ")); const fs = [];
const m = new Map([[3, "three"], [5, "five"], [8, "eight"]]); const list = [4, null, 2, undefined, 9, "x", 1.5]; const o = { i: 0, n: 0, get g() { say("get"); return this.i; } };
function* sub(k) { say("sub", k); if (k % 2) yield "s" + k; return k; } const tell = x => { say("t", x); return x; };
function* run(p) { fs.push(() => p); { for (var v1 = 0; v1 < 9; v1 += 2) { say("sent", yield v1); if (list[v1 % 9] == null) { continue; } if (!(v1 & 1)) { say("c", v1); continue; } } } say("end"); return o.n; }
await (async () => { try {
for (const x of run(2)) { say("x", x); if (out.length > 300) break; }
say([...run(1)].join());
} catch (x) { say("threw", x && x.message); } say(fs.map(f => f()).join()); say(o.i, o.n); console.log(out.slice(0, 2000).join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => out.push(a.join(" ")); const fs = [];
const m = new Map([[3, "three"], [5, "five"], [8, "eight"]]); const list = [4, null, 2, undefined, 9, "x", 1.5]; const o = { i: 0, n: 0, get g() { say("get"); return this.i; } };
function* sub(k) { say("sub", k); if (k % 2) yield "s" + k; return k; } const tell = x => { say("t", x); return x; };
async function run(p) { fs.push(() => p); { let v1 = -1; while (++v1 < 9) { switch (v1 % 3) { case 0: break; case 1: say("awaited", await v1); break; default: say("d"); } say("awaited", await v1); if (m.get(v1) == null) { o.n++; continue; } switch (v1 % 3) { case 0: continue; case 1: say(1); break; default: say("d"); } say("awaited", await v1); } } say("end"); return o.n; }
await (async () => { try {
try { say("result", await run(3)); } catch (x) { say("rejected", x.message); }
try { say("result", await run(3)); } catch (x) { say("rejected", x.message); }
try { say("result", await run(3)); } catch (x) { say("rejected", x.message); }
} catch (x) { say("threw", x && x.message); } say(fs.map(f => f()).join()); say(o.i, o.n); console.log(out.slice(0, 2000).join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => out.push(a.join(" ")); const fs = [];
const m = new Map([[3, "three"], [5, "five"], [8, "eight"]]); const list = [4, null, 2, undefined, 9, "x", 1.5]; const o = { i: 0, n: 0, get g() { say("get"); return this.i; } };
function* sub(k) { say("sub", k); if (k % 2) yield "s" + k; return k; } const tell = x => { say("t", x); return x; };
async function* run(p) { say("awaited", await p); { L1: for (let v1 = 0; v1 < 5; v1++) { try { const c2 = m.get(v1); if (c2) say(c2); if (v1 == 6) throw new Error("six"); } finally { say("f"); say("star", yield* sub(v1 | 0)); } switch (v1 % 3) { case 0: continue; case 1: say("star", yield* [v1, 1]); break; default: say("d"); } o.i += 2; say("i", o.i, v1); if (v1 > 50) { say("sent", yield v1); } else { o.n += 1; } if (m.get(v1) == null) { say("c", v1); continue; } } } say("end"); return o.n; }
await (async () => { try {
for await (const x of run(2)) { say("x", x); if (out.length > 300) break; }
} catch (x) { say("threw", x && x.message); } say(fs.map(f => f()).join()); say(o.i, o.n); console.log(out.slice(0, 2000).join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => out.push(a.join(" ")); const fs = [];
const m = new Map([[3, "three"], [5, "five"], [8, "eight"]]); const list = [4, null, 2, undefined, 9, "x", 1.5]; const o = { i: 0, n: 0, get g() { say("get"); return this.i; } };
function* sub(k) { say("sub", k); if (k % 2) yield "s" + k; return k; } const tell = x => { say("t", x); return x; };
function* run(p) {  { let v1 = 0; while (v1++ < 9) { try { if (false) { say("sent", yield v1); } else { o.n += 1; } if (v1 == 6) throw new Error("six"); } finally { say("f"); yield v1; } if (o.i > v1) { o.n++; continue; } fs.push(() => v1); { for (let v2 = 0; v2 < 2; v2++) { fs.push(() => v2); { let v3 = 0; do { if (++v3 > 2) break; if (o.g > 3) { yield v3; } else { o.n += 1; } if (o.i > v3) { yield v3; } else { o.n += 1; } if (v3 % 3 == 0) { o.n++; continue; } } while (v3 < 2); } { let v4 = 0; while (v4++ < 4) { if (tell(v4) < 2) { o.n++; continue; } switch (v4 % 3) { case 0: continue; case 1: say("sent", yield v4); break; default: say("d"); } } } } } } } say("end"); return o.n; }
await (async () => { try {
say([...run(1)].join());
} catch (x) { say("threw", x && x.message); } say(fs.map(f => f()).join()); say(o.i, o.n); console.log(out.slice(0, 2000).join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => out.push(a.join(" ")); const fs = [];
const m = new Map([[3, "three"], [5, "five"], [8, "eight"]]); const list = [4, null, 2, undefined, 9, "x", 1.5]; const o = { i: 0, n: 0, get g() { say("get"); return this.i; } };
function* sub(k) { say("sub", k); if (k % 2) yield "s" + k; return k; } const tell = x => { say("t", x); return x; };
async function* run(p) {  { let v1 = 0; while (v1++ < 12) { switch (v1 % 3) { case 0: continue; case 1: say(1); break; default: say("d"); } if (v1 % 3 == 0) { say("c", v1); continue; } } } say("end"); return o.n; }
await (async () => { try {
for await (const x of run(2)) { say("x", x); if (out.length > 300) break; }
for await (const x of run(2)) { say("x", x); if (out.length > 300) break; }
} catch (x) { say("threw", x && x.message); } say(fs.map(f => f()).join()); say(o.i, o.n); console.log(out.slice(0, 2000).join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => out.push(a.join(" ")); const fs = [];
const m = new Map([[3, "three"], [5, "five"], [8, "eight"]]); const list = [4, null, 2, undefined, 9, "x", 1.5]; const o = { i: 0, n: 0, get g() { say("get"); return this.i; } };
function* sub(k) { say("sub", k); if (k % 2) yield "s" + k; return k; } const tell = x => { say("t", x); return x; };
async function* run(p) {  { for (var v1 = 0; v1 < 12; v1 += 1) { switch (v1 % 3) { case 0: break; case 1: say(1); break; default: say("d"); } o.i += 2; say("i", o.i, v1); if (!(v1 & 1)) { continue; } } } say("end"); return o.n; }
await (async () => { try {
{ const g = run(1); let k = 0; for (;;) { const s = await g.next(k * 10); say("step", s.value, s.done); if (s.done || ++k > 8) break; }  }
for await (const x of run(2)) { say("x", x); if (out.length > 300) break; }
for await (const x of run(2)) { say("x", x); if (out.length > 300) break; }
} catch (x) { say("threw", x && x.message); } say(fs.map(f => f()).join()); say(o.i, o.n); console.log(out.slice(0, 2000).join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => out.push(a.join(" ")); const fs = [];
const m = new Map([[3, "three"], [5, "five"], [8, "eight"]]); const list = [4, null, 2, undefined, 9, "x", 1.5]; const o = { i: 0, n: 0, get g() { say("get"); return this.i; } };
function* sub(k) { say("sub", k); if (k % 2) yield "s" + k; return k; } const tell = x => { say("t", x); return x; };
function* run(p) { yield p; { for (var v1 = 0; v1 < 5; v1 += 1) { if (list[v1 % 9] == null) { say("c", v1); break; } if (tell(v1) < 2) { continue; } if (o.i > v1) { continue; } } } say("end"); return o.n; }
await (async () => { try {
{ const g = run(2); let k = 0; for (;;) { const s = g.next(k * 10); say("step", s.value, s.done); if (s.done || ++k > 30) break; } try { say(JSON.stringify(g.throw(new Error("in")))); } catch (x) { say(x.message); } }
} catch (x) { say("threw", x && x.message); } say(fs.map(f => f()).join()); say(o.i, o.n); console.log(out.slice(0, 2000).join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => out.push(a.join(" ")); const fs = [];
const m = new Map([[3, "three"], [5, "five"], [8, "eight"]]); const list = [4, null, 2, undefined, 9, "x", 1.5]; const o = { i: 0, n: 0, get g() { say("get"); return this.i; } };
function* sub(k) { say("sub", k); if (k % 2) yield "s" + k; return k; } const tell = x => { say("t", x); return x; };
function* run(p) { yield p; { for (let v1 = 0, w = 0; v1 < 5; v1++, w = v1) { if (o.i > v1) { o.n++; continue; } yield v1; { let v2 = 0; L2: do { if (++v2 > 2) break; const c3 = m.get(v2); if (c3) say(c3); const c4 = m.get(v2); if (c4) say(c4); if (!(v2 & 1)) { say("star", yield* [v2, 1]); } else { o.n += 1; } } while (v2 < 2); } o.i += 1; say("i", o.i, v1); { for (var v5 = 0; v5 < 4; v5 += 2) { { let v6 = 0; while (v6++ < 4) { try { try { say("star", yield* [v6, 1]);  } catch (x) { say("caught", x && x.message); }  } finally { say("f");  } if (m.get(v6) == null) { o.n++; break; } yield v6; } } o.i += 2; say("i", o.i, v5); say("sent", yield v5); } } say("w", w); } } say("end"); return o.n; }
await (async () => { try {
for (const x of run(2)) { say("x", x); if (out.length > 300) break; }
} catch (x) { say("threw", x && x.message); } say(fs.map(f => f()).join()); say(o.i, o.n); console.log(out.slice(0, 2000).join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => out.push(a.join(" ")); const fs = [];
const m = new Map([[3, "three"], [5, "five"], [8, "eight"]]); const list = [4, null, 2, undefined, 9, "x", 1.5]; const o = { i: 0, n: 0, get g() { say("get"); return this.i; } };
function* sub(k) { say("sub", k); if (k % 2) yield "s" + k; return k; } const tell = x => { say("t", x); return x; };
function* run(p) {  { for (let v1 = 0; v1 < 9; v1++) { if (false) { o.n++; continue; } { let v2 = 0; do { if (++v2 > 4) break; if (m.get(v2) == null) { say("c", v2); continue; } if (false) { say("c", v2); continue; } yield v2; fs.push(() => v2); } while (v2 < 4); } { for (var v3 = 0; v3 < 4; v3 += 2) { o.i += 2; say("i", o.i, v3); fs.push(() => v3); if (list[v3 % 9] == null) { continue; } if (o.i > v3) { break; } if (v3 % 3 == 0) { yield v3; } else { o.n += 1; } } } { for (let v4 = 0; v4 < 4; v4++) { { let v5 = -1; L5: while (++v5 < 2) { const c6 = m.get(v5); if (c6) say(c6); if (v5 % 3 == 0) { yield v5; } else { o.n += 1; } say("sent", yield v5); if (tell(v5) < 2) { o.n++; continue; } } } try { o.i += 2; say("i", o.i, v4); if (v4 == 6) throw new Error("six"); } catch (x) { say("caught", x && x.message); } try { fs.push(() => v4); if (v4 == 6) throw new Error("six"); } finally { say("f"); yield v4; } say("sent", yield v4); } } yield v1; } } say("end"); return o.n; }
await (async () => { try {
for (const x of run(2)) { say("x", x); if (out.length > 300) break; }
for (const x of run(2)) { say("x", x); if (out.length > 300) break; }
say([...run(1)].join());
} catch (x) { say("threw", x && x.message); } say(fs.map(f => f()).join()); say(o.i, o.n); console.log(out.slice(0, 2000).join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => out.push(a.join(" ")); const fs = [];
const m = new Map([[3, "three"], [5, "five"], [8, "eight"]]); const list = [4, null, 2, undefined, 9, "x", 1.5]; const o = { i: 0, n: 0, get g() { say("get"); return this.i; } };
function* sub(k) { say("sub", k); if (k % 2) yield "s" + k; return k; } const tell = x => { say("t", x); return x; };
function* run(p) {  { let v1 = 0; while (v1++ < 9) { fs.push(() => v1); const c2 = m.get(v1); if (c2) say(c2); } } say("end"); return o.n; }
await (async () => { try {
say([...run(1)].join());
{ const g = run(2); let k = 0; for (;;) { const s = g.next(k * 10); say("step", s.value, s.done); if (s.done || ++k > 8) break; }  }
} catch (x) { say("threw", x && x.message); } say(fs.map(f => f()).join()); say(o.i, o.n); console.log(out.slice(0, 2000).join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => out.push(a.join(" ")); const fs = [];
const m = new Map([[3, "three"], [5, "five"], [8, "eight"]]); const list = [4, null, 2, undefined, 9, "x", 1.5]; const o = { i: 0, n: 0, get g() { say("get"); return this.i; } };
function* sub(k) { say("sub", k); if (k % 2) yield "s" + k; return k; } const tell = x => { say("t", x); return x; };
async function run(p) { say("awaited", await p); { let v1 = 0; L1: do { if (++v1 > 5) break; if (!(v1 & 1)) { continue; } if (tell(v1) < 2) { break L1; } if (v1 % 3 == 0) { o.n++; continue L1; } switch (v1 % 3) { case 0: continue; case 1: say(1); break; default: say("d"); } } while (v1 < 5); } say("end"); return o.n; }
await (async () => { try {
try { say("result", await run(1)); } catch (x) { say("rejected", x.message); }
} catch (x) { say("threw", x && x.message); } say(fs.map(f => f()).join()); say(o.i, o.n); console.log(out.slice(0, 2000).join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => out.push(a.join(" ")); const fs = [];
const m = new Map([[3, "three"], [5, "five"], [8, "eight"]]); const list = [4, null, 2, undefined, 9, "x", 1.5]; const o = { i: 0, n: 0, get g() { say("get"); return this.i; } };
function* sub(k) { say("sub", k); if (k % 2) yield "s" + k; return k; } const tell = x => { say("t", x); return x; };
async function run(p) {  { L1: for (var v1 = 0; v1 < 12; v1 += 2) { if (o.i > v1) { say("c", v1); continue; } o.i += 1; say("i", o.i, v1); try { const c2 = m.get(v1); if (c2) say(c2);  } catch (x) { say("caught", x && x.message); } try { if (v1 % 3 == 0) { await tell(v1); } else { o.n += 1; } if (v1 == 6) throw new Error("six"); } catch (x) { say("caught", x && x.message); } if (false) { say("c", v1); continue; } } } say("end"); return o.n; }
await (async () => { try {
try { say("result", await run(4)); } catch (x) { say("rejected", x.message); }
try { say("result", await run(4)); } catch (x) { say("rejected", x.message); }
} catch (x) { say("threw", x && x.message); } say(fs.map(f => f()).join()); say(o.i, o.n); console.log(out.slice(0, 2000).join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => out.push(a.join(" ")); const fs = [];
const m = new Map([[3, "three"], [5, "five"], [8, "eight"]]); const list = [4, null, 2, undefined, 9, "x", 1.5]; const o = { i: 0, n: 0, get g() { say("get"); return this.i; } };
function* sub(k) { say("sub", k); if (k % 2) yield "s" + k; return k; } const tell = x => { say("t", x); return x; };
function* run(p) { o.i += 1; say("i", o.i, p); { L1: for (var v1 = 0; v1 < 5; v1 += 2) { { for (var v2 = 0; v2 < 2; v2 += 1) { { let v3 = 0; while (v3++ < 2) { try { if (list[v3 % 9] == null) { say("c", v3); continue; } if (v3 == 6) throw new Error("six"); } catch (x) { say("caught", x && x.message); } yield v3; if (o.g > 3) { say("sent", yield v3); } else { o.n += 1; } if (!(v3 & 1)) { say("c", v3); continue; } } } switch (v2 % 3) { case 0: break; case 1: say(1); break; default: say("d"); } if (o.g > 3) { say("star", yield* sub(v2 | 0)); } else { o.n += 1; } if (o.i > v2) { continue L1; } } } try { fs.push(() => v1); if (v1 == 6) throw new Error("six"); } finally { say("f");  } yield v1; try { const c4 = m.get(v1); if (c4) say(c4); if (v1 == 6) throw new Error("six"); } finally { say("f"); yield v1; } } } say("end"); return o.n; }
await (async () => { try {
for (const x of run(2)) { say("x", x); if (out.length > 300) break; }
} catch (x) { say("threw", x && x.message); } say(fs.map(f => f()).join()); say(o.i, o.n); console.log(out.slice(0, 2000).join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => out.push(a.join(" ")); const fs = [];
const m = new Map([[3, "three"], [5, "five"], [8, "eight"]]); const list = [4, null, 2, undefined, 9, "x", 1.5]; const o = { i: 0, n: 0, get g() { say("get"); return this.i; } };
function* sub(k) { say("sub", k); if (k % 2) yield "s" + k; return k; } const tell = x => { say("t", x); return x; };
function* run(p) { say("sent", yield p); { for (let v1 = 0; v1 < 5; v1++) { const c2 = m.get(v1); if (c2) say(c2); if (list[v1 % 9] == null) { say("c", v1); continue; } } } say("end"); return o.n; }
await (async () => { try {
{ const g = run(0); let k = 0; for (;;) { const s = g.next(k * 10); say("step", s.value, s.done); if (s.done || ++k > 30) break; }  }
{ const g = run(0); let k = 0; for (;;) { const s = g.next(k * 10); say("step", s.value, s.done); if (s.done || ++k > 30) break; }  }
{ const g = run(0); let k = 0; for (;;) { const s = g.next(k * 10); say("step", s.value, s.done); if (s.done || ++k > 30) break; }  }
} catch (x) { say("threw", x && x.message); } say(fs.map(f => f()).join()); say(o.i, o.n); console.log(out.slice(0, 2000).join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => out.push(a.join(" ")); const fs = [];
const m = new Map([[3, "three"], [5, "five"], [8, "eight"]]); const list = [4, null, 2, undefined, 9, "x", 1.5]; const o = { i: 0, n: 0, get g() { say("get"); return this.i; } };
function* sub(k) { say("sub", k); if (k % 2) yield "s" + k; return k; } const tell = x => { say("t", x); return x; };
function* run(p) { if (m.get(p) == null) { say("star", yield* sub(p | 0)); } else { o.n += 1; } { let v1 = -1; while (++v1 < 12) { { L2: for (var v2 = 0; v2 < 4; v2 += 1) { fs.push(() => v2); if (tell(v2) < 2) { o.n++; continue; } if (list[v2 % 9] == null) { o.n++; continue; } if (false) { yield v2; } else { o.n += 1; } } } yield v1; if (v1 % 3 == 0) { say("c", v1); continue; } const c3 = m.get(v1); if (c3) say(c3); } } say("end"); return o.n; }
await (async () => { try {
{ const g = run(1); let k = 0; for (;;) { const s = g.next(k * 10); say("step", s.value, s.done); if (s.done || ++k > 30) break; } try { say(JSON.stringify(g.throw(new Error("in")))); } catch (x) { say(x.message); } }
{ const g = run(1); let k = 0; for (;;) { const s = g.next(k * 10); say("step", s.value, s.done); if (s.done || ++k > 30) break; } try { say(JSON.stringify(g.throw(new Error("in")))); } catch (x) { say(x.message); } }
say([...run(1)].join());
} catch (x) { say("threw", x && x.message); } say(fs.map(f => f()).join()); say(o.i, o.n); console.log(out.slice(0, 2000).join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => out.push(a.join(" ")); const fs = [];
const m = new Map([[3, "three"], [5, "five"], [8, "eight"]]); const list = [4, null, 2, undefined, 9, "x", 1.5]; const o = { i: 0, n: 0, get g() { say("get"); return this.i; } };
function* sub(k) { say("sub", k); if (k % 2) yield "s" + k; return k; } const tell = x => { say("t", x); return x; };
function* run(p) { yield p; { let v1 = 0; while (v1 < 5) { v1++; o.i += 1; say("i", o.i, v1); switch (v1 % 3) { case 0: continue; case 1: say(1); break; default: say("d"); } { for (let v2 = 0, w = 0; v2 < 4; v2++, w = v2) { if (o.g > 3) { continue; } yield v2; o.i += 2; say("i", o.i, v2); say("w", w); } } o.i += 2; say("i", o.i, v1); if (false) { continue; } } } say("end"); return o.n; }
await (async () => { try {
for (const x of run(2)) { say("x", x); if (out.length > 300) break; }
{ const g = run(0); let k = 0; for (;;) { const s = g.next(k * 10); say("step", s.value, s.done); if (s.done || ++k > 3) break; } try { say(JSON.stringify(g.throw(new Error("in")))); } catch (x) { say(x.message); } }
for (const x of run(2)) { say("x", x); if (out.length > 300) break; }
} catch (x) { say("threw", x && x.message); } say(fs.map(f => f()).join()); say(o.i, o.n); console.log(out.slice(0, 2000).join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => out.push(a.join(" ")); const fs = [];
const m = new Map([[3, "three"], [5, "five"], [8, "eight"]]); const list = [4, null, 2, undefined, 9, "x", 1.5]; const o = { i: 0, n: 0, get g() { say("get"); return this.i; } };
function* sub(k) { say("sub", k); if (k % 2) yield "s" + k; return k; } const tell = x => { say("t", x); return x; };
function* run(p) {  { for (let v1 = 0; v1 < 9; v1++) { if (m.get(v1) == null) { o.n++; continue; } switch (v1 % 3) { case 0: break; case 1: say("sent", yield v1); break; default: say("d"); } if (tell(v1) < 2) { say("c", v1); break; } if (false) { break; } } } say("end"); return o.n; }
await (async () => { try {
say([...run(1)].join());
for (const x of run(2)) { say("x", x); if (out.length > 300) break; }
} catch (x) { say("threw", x && x.message); } say(fs.map(f => f()).join()); say(o.i, o.n); console.log(out.slice(0, 2000).join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => out.push(a.join(" ")); const fs = [];
const m = new Map([[3, "three"], [5, "five"], [8, "eight"]]); const list = [4, null, 2, undefined, 9, "x", 1.5]; const o = { i: 0, n: 0, get g() { say("get"); return this.i; } };
function* sub(k) { say("sub", k); if (k % 2) yield "s" + k; return k; } const tell = x => { say("t", x); return x; };
async function* run(p) {  { let v1 = 0; do { if (++v1 > 12) break; try { if (v1 % 3 == 0) { say("star", yield* sub(1)); } else { o.n += 1; }  } finally { say("f");  } o.i += 1; say("i", o.i, v1); { for (let v2 = 0; v2 < 4; v2++) { o.i += 2; say("i", o.i, v2); if (m.get(v2) == null) { say("c", v2); break; } if (v2 % 3 == 0) { await tell(v2); } else { o.n += 1; } } } yield v1; fs.push(() => v1); } while (v1 < 12); } say("end"); return o.n; }
await (async () => { try {
for await (const x of run(2)) { say("x", x); if (out.length > 300) break; }
{ const g = run(2); let k = 0; for (;;) { const s = await g.next(k * 10); say("step", s.value, s.done); if (s.done || ++k > 30) break; } try { say(JSON.stringify(await g.throw(new Error("in")))); } catch (x) { say(x.message); } }
} catch (x) { say("threw", x && x.message); } say(fs.map(f => f()).join()); say(o.i, o.n); console.log(out.slice(0, 2000).join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => out.push(a.join(" ")); const fs = [];
const m = new Map([[3, "three"], [5, "five"], [8, "eight"]]); const list = [4, null, 2, undefined, 9, "x", 1.5]; const o = { i: 0, n: 0, get g() { say("get"); return this.i; } };
function* sub(k) { say("sub", k); if (k % 2) yield "s" + k; return k; } const tell = x => { say("t", x); return x; };
function* run(p) { yield p; { let v1 = -1; while (++v1 < 5) { { let v2 = -1; L2: while (++v2 < 4) { yield v2; { let v3 = 0; L3: while (v3++ < 4) { yield v3; const c4 = m.get(v3); if (c4) say(c4); if (!(v3 & 1)) { yield v3; } else { o.n += 1; } if (o.i > v3) { say("c", v3); continue; } } } yield v2; if (!(v2 & 1)) { yield v2; } else { o.n += 1; } } } if (m.get(v1) == null) { o.n++; continue; } switch (v1 % 3) { case 0: continue; case 1: yield v1; break; default: say("d"); } if (v1 > 50) { yield v1; } else { o.n += 1; } o.i += 2; say("i", o.i, v1); } } say("end"); return o.n; }
await (async () => { try {
{ const g = run(0); let k = 0; for (;;) { const s = g.next(k * 10); say("step", s.value, s.done); if (s.done || ++k > 3) break; } say(JSON.stringify(g.return(7))); }
say([...run(1)].join());
} catch (x) { say("threw", x && x.message); } say(fs.map(f => f()).join()); say(o.i, o.n); console.log(out.slice(0, 2000).join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => out.push(a.join(" ")); const fs = [];
const m = new Map([[3, "three"], [5, "five"], [8, "eight"]]); const list = [4, null, 2, undefined, 9, "x", 1.5]; const o = { i: 0, n: 0, get g() { say("get"); return this.i; } };
function* sub(k) { say("sub", k); if (k % 2) yield "s" + k; return k; } const tell = x => { say("t", x); return x; };
function* run(p) {  { let v1 = 0; L1: while (v1++ < 5) { { let v2 = 0; L2: do { if (++v2 > 4) break; { let v3 = 0; while (v3 < 4) { v3++; yield v3; if (o.g > 3) { o.n++; continue L1; } } } say("sent", yield v2); try { if (tell(v2) < 2) { say("c", v2); continue; } if (v2 == 6) throw new Error("six"); } catch (x) { say("caught", x && x.message); } } while (v2 < 4); } if (m.get(v1) == null) { yield v1; } else { o.n += 1; } } } say("end"); return o.n; }
await (async () => { try {
for (const x of run(2)) { say("x", x); if (out.length > 300) break; }
} catch (x) { say("threw", x && x.message); } say(fs.map(f => f()).join()); say(o.i, o.n); console.log(out.slice(0, 2000).join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => out.push(a.join(" ")); const fs = [];
const m = new Map([[3, "three"], [5, "five"], [8, "eight"]]); const list = [4, null, 2, undefined, 9, "x", 1.5]; const o = { i: 0, n: 0, get g() { say("get"); return this.i; } };
function* sub(k) { say("sub", k); if (k % 2) yield "s" + k; return k; } const tell = x => { say("t", x); return x; };
function* run(p) {  { let v1 = 0; while (v1++ < 5) { yield v1; if (v1 % 3 == 0) { continue; } if (!(v1 & 1)) { say("c", v1); continue; } switch (v1 % 3) { case 0: continue; case 1: say(1); break; default: say("d"); } } } say("end"); return o.n; }
await (async () => { try {
{ const g = run(2); let k = 0; for (;;) { const s = g.next(k * 10); say("step", s.value, s.done); if (s.done || ++k > 8) break; }  }
{ const g = run(2); let k = 0; for (;;) { const s = g.next(k * 10); say("step", s.value, s.done); if (s.done || ++k > 8) break; }  }
for (const x of run(2)) { say("x", x); if (out.length > 300) break; }
} catch (x) { say("threw", x && x.message); } say(fs.map(f => f()).join()); say(o.i, o.n); console.log(out.slice(0, 2000).join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => out.push(a.join(" ")); const fs = [];
const m = new Map([[3, "three"], [5, "five"], [8, "eight"]]); const list = [4, null, 2, undefined, 9, "x", 1.5]; const o = { i: 0, n: 0, get g() { say("get"); return this.i; } };
function* sub(k) { say("sub", k); if (k % 2) yield "s" + k; return k; } const tell = x => { say("t", x); return x; };
function* run(p) { const c1 = m.get(p); if (c1) say(c1); { let v2 = 0; while (v2++ < 5) { if (v2 > 50) { break; } say("star", yield* sub(1)); } } say("end"); return o.n; }
await (async () => { try {
{ const g = run(2); let k = 0; for (;;) { const s = g.next(k * 10); say("step", s.value, s.done); if (s.done || ++k > 30) break; } try { say(JSON.stringify(g.throw(new Error("in")))); } catch (x) { say(x.message); } }
say([...run(1)].join());
} catch (x) { say("threw", x && x.message); } say(fs.map(f => f()).join()); say(o.i, o.n); console.log(out.slice(0, 2000).join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => out.push(a.join(" ")); const fs = [];
const m = new Map([[3, "three"], [5, "five"], [8, "eight"]]); const list = [4, null, 2, undefined, 9, "x", 1.5]; const o = { i: 0, n: 0, get g() { say("get"); return this.i; } };
function* sub(k) { say("sub", k); if (k % 2) yield "s" + k; return k; } const tell = x => { say("t", x); return x; };
function* run(p) { fs.push(() => p); { let v1 = 0; L1: while (v1 < 9) { v1++; if (o.g > 3) { continue; } fs.push(() => v1); fs.push(() => v1); fs.push(() => v1); try { say("star", yield* sub(v1 | 0)); if (v1 == 6) throw new Error("six"); } catch (x) { say("caught", x && x.message); } } } say("end"); return o.n; }
await (async () => { try {
for (const x of run(2)) { say("x", x); if (out.length > 300) break; }
say([...run(1)].join());
} catch (x) { say("threw", x && x.message); } say(fs.map(f => f()).join()); say(o.i, o.n); console.log(out.slice(0, 2000).join("\n")); })();
})();
