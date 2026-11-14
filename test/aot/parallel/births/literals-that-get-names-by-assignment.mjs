// Objects that begin as {} or a constant literal and get their names by assignment, seen and changed on the way.
try { (() => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "object" && x ? "{" + Object.keys(x).map(k => k + ":" + (typeof x[k] === "object" && x[k] ? "o" : typeof x[k] === "function" ? "f" : x[k])) + "}" : String(x)).join(" ")); return a[0]; };
const seen = new Map(), all = []; function look(o) { all.push(o); seen.set(all.length, o); return Object.keys(o).length; } function peek(o) { return (o.a ?? 0) + (o.b ?? 0) + (o.d ? 1 : 0); } function boom(v) { if (v === 3) throw new Error("three"); return v; }
function make0(v) { const o = { a: 1, b: "t" }; for (let i = 0; i < 2; i++) o.a = i + v; say(peek(o)); o.c = v; return o; }
const lib0 = { f: null }; lib0.f = function (x) { return (this.a ?? 0) + "|" + (this.b ?? 0); };
function read0(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.a + "," + q.e + ";";   } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make0(i)); } catch (z) { say("threw", z.message); } } try { say(read0(list)); say(read0(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib0.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read0(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
function make1(v) { const o = {}; look(o); o.d = "s"; for (let i = 0; i < 2; i++) o.c = i + v; const p = o; p.a = undefined; o.e = null; look(o); return o; }
const lib1 = { f: null }; lib1.f = function (x) { return (this.a ?? 0) + "|" + (this.a ?? 0); };
function read1(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.d + "," + q.d + ";"; q.a = i;  } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make1(i)); } catch (z) { say("threw", z.message); } } try { say(read1(list)); say(read1(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib1.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read1(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
for (const o of all.slice(0, 8)) say(o, peek(o)); console.log(out.join("\n"));
})(); } catch (error) { console.log(error.constructor.name); }
try { (() => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "object" && x ? "{" + Object.keys(x).map(k => k + ":" + (typeof x[k] === "object" && x[k] ? "o" : typeof x[k] === "function" ? "f" : x[k])) + "}" : String(x)).join(" ")); return a[0]; };
const seen = new Map(), all = []; function look(o) { all.push(o); seen.set(all.length, o); return Object.keys(o).length; } function peek(o) { return (o.a ?? 0) + (o.b ?? 0) + (o.d ? 1 : 0); } function boom(v) { if (v === 3) throw new Error("three"); return v; }
function make0(v) { const o = { c: undefined }; o.c = v * 0.5; o.d = 1; (() => { o.e = 1; })(); o.a = 1; return o; }
const lib0 = { f: null }; lib0.f = function (x) { if (this.b > 1) return (this.d ?? 0) + "|" + (this.a ?? 0); };
function read0(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.c + "," + q.b + ";";  if (q.a === undefined) continue; t += q.a; } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make0(i)); } catch (z) { say("threw", z.message); } } try { say(read0(list)); say(read0(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib0.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read0(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
for (const o of all.slice(0, 8)) say(o, peek(o)); console.log(out.join("\n"));
})(); } catch (error) { console.log(error.constructor.name); }
try { (() => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "object" && x ? "{" + Object.keys(x).map(k => k + ":" + (typeof x[k] === "object" && x[k] ? "o" : typeof x[k] === "function" ? "f" : x[k])) + "}" : String(x)).join(" ")); return a[0]; };
const seen = new Map(), all = []; function look(o) { all.push(o); seen.set(all.length, o); return Object.keys(o).length; } function peek(o) { return (o.a ?? 0) + (o.b ?? 0) + (o.d ? 1 : 0); } function boom(v) { if (v === 3) throw new Error("three"); return v; }
function make0(v) { const o = {}; Object.defineProperty(o, "c", { get() { return 8; }, enumerable: true, configurable: true }); o.a = "s"; say(peek(o)); o.e = v; return o; }
const lib0 = { f: null }; lib0.f = function (x) { if (this.b > 1) return (this.a ?? 0) + "|" + (this.a ?? 0); };
function read0(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.c + "," + q.a + ";";   } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make0(i)); } catch (z) { say("threw", z.message); } } try { say(read0(list)); say(read0(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib0.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read0(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
function make1(v) { const o = {}; o.e = "s"; o.b = 1; for (let i = 0; i < 2; i++) o.d = i + v; return o; }
const lib1 = { f: null }; lib1.f = function (x) { return (this.d ?? 0) + "|" + (this.d ?? 0); };
function read1(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.e + "," + q.c + ";";   } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make1(i)); } catch (z) { say("threw", z.message); } } try { say(read1(list)); say(read1(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib1.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read1(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
for (const o of all.slice(0, 8)) say(o, peek(o)); console.log(out.join("\n"));
})(); } catch (error) { console.log(error.constructor.name); }
try { (() => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "object" && x ? "{" + Object.keys(x).map(k => k + ":" + (typeof x[k] === "object" && x[k] ? "o" : typeof x[k] === "function" ? "f" : x[k])) + "}" : String(x)).join(" ")); return a[0]; };
const seen = new Map(), all = []; function look(o) { all.push(o); seen.set(all.length, o); return Object.keys(o).length; } function peek(o) { return (o.a ?? 0) + (o.b ?? 0) + (o.d ? 1 : 0); } function boom(v) { if (v === 3) throw new Error("three"); return v; }
function make0(v) { const o = { c: undefined }; look(o); o.b = boom(v); o.e = { k: v }; say(peek(o)); o.d = "s"; if (v > 2) o.a = v; return o; }
const lib0 = { f: null }; lib0.f = function (x) { if (this.b > 1) return (this.d ?? 0) + "|" + (this.b ?? 0); };
function read0(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.b + "," + q.b + ";";   } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make0(i)); } catch (z) { say("threw", z.message); } } try { say(read0(list)); say(read0(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib0.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read0(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
function make1(v) { const o = { a: v }; for (let i = 0; i < 2; i++) o.d = i + v; o.e = [v]; const p = o; p.a = v + 1; o.c = "s"; look(o); return o; }
const lib1 = { f: null }; lib1.f = function (x) { this.a = x; return (this.a ?? 0) + "|" + (this.a ?? 0); };
function read1(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.d + "," + q.c + ";"; q.e = i; if (q.a === undefined) continue; t += q.a; } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make1(i)); } catch (z) { say("threw", z.message); } } try { say(read1(list)); say(read1(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib1.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read1(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
function make2(v) { const o = { a: 1 }; for (let i = 0; i < 2; i++) o.a = i + v; try { o.b = boom(v); } catch (z) { o.b = -1; } o.d = 1; if (v == 4) Object.freeze(o); look(o); return o; }
const lib2 = { f: null }; lib2.f = function (x) { if (this.b > 1) return (this.a ?? 0) + "|" + (this.d ?? 0); };
function read2(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.a + "," + q.b + ";"; q.c = i;  } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make2(i)); } catch (z) { say("threw", z.message); } } try { say(read2(list)); say(read2(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib2.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read2(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
for (const o of all.slice(0, 8)) say(o, peek(o)); console.log(out.join("\n"));
})(); } catch (error) { console.log(error.constructor.name); }
try { (() => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "object" && x ? "{" + Object.keys(x).map(k => k + ":" + (typeof x[k] === "object" && x[k] ? "o" : typeof x[k] === "function" ? "f" : x[k])) + "}" : String(x)).join(" ")); return a[0]; };
const seen = new Map(), all = []; function look(o) { all.push(o); seen.set(all.length, o); return Object.keys(o).length; } function peek(o) { return (o.a ?? 0) + (o.b ?? 0) + (o.d ? 1 : 0); } function boom(v) { if (v === 3) throw new Error("three"); return v; }
function make0(v) { const o = {}; switch (v % 3) { case 0: o.c = v + 1; break; case 1: o.a = undefined; default: o.c = 0; } for (let i = 0; i < 2; i++) o.d = i + v; o.b = [v]; look(o); return o; }
const lib0 = { f: null }; lib0.f = function (x) { return (this.d ?? 0) + "|" + (this.a ?? 0); };
function read0(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.c + "," + q.c + ";";   } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make0(i)); } catch (z) { say("threw", z.message); } } try { say(read0(list)); say(read0(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib0.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read0(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
for (const o of all.slice(0, 8)) say(o, peek(o)); console.log(out.join("\n"));
})(); } catch (error) { console.log(error.constructor.name); }
try { (() => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "object" && x ? "{" + Object.keys(x).map(k => k + ":" + (typeof x[k] === "object" && x[k] ? "o" : typeof x[k] === "function" ? "f" : x[k])) + "}" : String(x)).join(" ")); return a[0]; };
const seen = new Map(), all = []; function look(o) { all.push(o); seen.set(all.length, o); return Object.keys(o).length; } function peek(o) { return (o.a ?? 0) + (o.b ?? 0) + (o.d ? 1 : 0); } function boom(v) { if (v === 3) throw new Error("three"); return v; }
function make0(v) { const o = {}; o.d = v + 1; o.a = null; o.c = v + 1; o.e = { k: v }; look(o); return o; }
const lib0 = { f: null }; lib0.f = function (x) { this.a = x; return (this.e ?? 0) + "|" + (this.b ?? 0); };
function read0(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.d + "," + q.a + ";"; q.c = i;  } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make0(i)); } catch (z) { say("threw", z.message); } } try { say(read0(list)); say(read0(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib0.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read0(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
function make1(v) { const o = { a: 1 }; switch (v % 3) { case 0: o.e = [v]; break; case 1: o.b = "s"; default: o.e = 0; } try { o.b = boom(v); } catch (z) { o.b = -1; } look(o); return o; }
const lib1 = { f: null }; lib1.f = function (x) { if (this.b > 1) return (this.e ?? 0) + "|" + (this.a ?? 0); };
function read1(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.e + "," + q.b + ";";   } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make1(i)); } catch (z) { say("threw", z.message); } } try { say(read1(list)); say(read1(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib1.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read1(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
function make2(v) { const o = { a: 1 }; o.e = { k: v }; return o; }
const lib2 = { f: null }; lib2.f = function (x) { return (this.e ?? 0) + "|" + (this.c ?? 0); };
function read2(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.e + "," + q.b + ";";   } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make2(i)); } catch (z) { say("threw", z.message); } } try { say(read2(list)); say(read2(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib2.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read2(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
for (const o of all.slice(0, 8)) say(o, peek(o)); console.log(out.join("\n"));
})(); } catch (error) { console.log(error.constructor.name); }
try { (() => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "object" && x ? "{" + Object.keys(x).map(k => k + ":" + (typeof x[k] === "object" && x[k] ? "o" : typeof x[k] === "function" ? "f" : x[k])) + "}" : String(x)).join(" ")); return a[0]; };
const seen = new Map(), all = []; function look(o) { all.push(o); seen.set(all.length, o); return Object.keys(o).length; } function peek(o) { return (o.a ?? 0) + (o.b ?? 0) + (o.d ? 1 : 0); } function boom(v) { if (v === 3) throw new Error("three"); return v; }
function make0(v) { const o = {}; o.b = [v]; (() => { o.e = v + 1; })(); look(o); o.c = v; try { o.a = boom(v); } catch (z) { o.a = -1; } return o; }
const lib0 = { f: null }; lib0.f = function (x) { this.a = x; return (this.c ?? 0) + "|" + (this.b ?? 0); };
function read0(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.b + "," + q.e + ";";  if (q.a === undefined) continue; t += q.a; } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make0(i)); } catch (z) { say("threw", z.message); } } try { say(read0(list)); say(read0(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib0.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read0(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
function make1(v) { const o = { a: 1, b: "t" }; look(o); o.d = v; say(peek(o)); o.c = v * 0.5; if (v > 2) o.e = null; return o; }
const lib1 = { f: null }; lib1.f = function (x) { if (this.b > 1) return (this.c ?? 0) + "|" + (this.a ?? 0); };
function read1(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.d + "," + q.d + ";";  if (q.a === undefined) continue; t += q.a; } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make1(i)); } catch (z) { say("threw", z.message); } } try { say(read1(list)); say(read1(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib1.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read1(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
function make2(v) { const o = { a: 1 }; o.c = "s"; look(o); return o; }
const lib2 = { f: null }; lib2.f = function (x) { this.a = x; return (this.c ?? 0) + "|" + (this.d ?? 0); };
function read2(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.c + "," + q.c + ";";   } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make2(i)); } catch (z) { say("threw", z.message); } } try { say(read2(list)); say(read2(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib2.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read2(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
for (const o of all.slice(0, 8)) say(o, peek(o)); console.log(out.join("\n"));
})(); } catch (error) { console.log(error.constructor.name); }
try { (() => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "object" && x ? "{" + Object.keys(x).map(k => k + ":" + (typeof x[k] === "object" && x[k] ? "o" : typeof x[k] === "function" ? "f" : x[k])) + "}" : String(x)).join(" ")); return a[0]; };
const seen = new Map(), all = []; function look(o) { all.push(o); seen.set(all.length, o); return Object.keys(o).length; } function peek(o) { return (o.a ?? 0) + (o.b ?? 0) + (o.d ? 1 : 0); } function boom(v) { if (v === 3) throw new Error("three"); return v; }
function make0(v) { const o = { a: v }; o.a = v * 0.5; o.e = 1; o.c = 1; return o; }
const lib0 = { f: null }; lib0.f = function (x) { this.a = x; return (this.e ?? 0) + "|" + (this.b ?? 0); };
function read0(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.a + "," + q.a + ";"; q.c = i; if (q.a === undefined) continue; t += q.a; } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make0(i)); } catch (z) { say("threw", z.message); } } try { say(read0(list)); say(read0(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib0.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read0(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
function make1(v) { const o = {}; o.c = 1; look(o); return o; }
const lib1 = { f: null }; lib1.f = function (x) { return (this.c ?? 0) + "|" + (this.e ?? 0); };
function read1(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.c + "," + q.a + ";"; q.e = i; if (q.a === undefined) continue; t += q.a; } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make1(i)); } catch (z) { say("threw", z.message); } } try { say(read1(list)); say(read1(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib1.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read1(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
for (const o of all.slice(0, 8)) say(o, peek(o)); console.log(out.join("\n"));
})(); } catch (error) { console.log(error.constructor.name); }
try { (() => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "object" && x ? "{" + Object.keys(x).map(k => k + ":" + (typeof x[k] === "object" && x[k] ? "o" : typeof x[k] === "function" ? "f" : x[k])) + "}" : String(x)).join(" ")); return a[0]; };
const seen = new Map(), all = []; function look(o) { all.push(o); seen.set(all.length, o); return Object.keys(o).length; } function peek(o) { return (o.a ?? 0) + (o.b ?? 0) + (o.d ? 1 : 0); } function boom(v) { if (v === 3) throw new Error("three"); return v; }
function make0(v) { const o = { c: undefined }; try { o.a = boom(v); } catch (z) { o.a = -1; } (() => { o.d = 1; })(); if (v > 2) o.e = { k: v }; else o.d = "s"; look(o); return o; }
const lib0 = { f: null }; lib0.f = function (x) { if (this.b > 1) return (this.a ?? 0) + "|" + (this.b ?? 0); };
function read0(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.a + "," + q.c + ";"; q.b = i;  } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make0(i)); } catch (z) { say("threw", z.message); } } try { say(read0(list)); say(read0(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib0.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read0(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
function make1(v) { const o = {}; switch (v % 3) { case 0: o.b = 1; break; case 1: o.e = boom(v); default: o.b = 0; } if (v > 2) o.e = v * 0.5; else o.b = 1; o.d = v + 1; for (let i = 0; i < 2; i++) o.c = i + v; look(o); return o; }
const lib1 = { f: null }; lib1.f = function (x) { this.a = x; return (this.c ?? 0) + "|" + (this.e ?? 0); };
function read1(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.b + "," + q.d + ";"; q.d = i;  } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make1(i)); } catch (z) { say("threw", z.message); } } try { say(read1(list)); say(read1(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib1.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read1(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
for (const o of all.slice(0, 8)) say(o, peek(o)); console.log(out.join("\n"));
})(); } catch (error) { console.log(error.constructor.name); }
try { (() => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "object" && x ? "{" + Object.keys(x).map(k => k + ":" + (typeof x[k] === "object" && x[k] ? "o" : typeof x[k] === "function" ? "f" : x[k])) + "}" : String(x)).join(" ")); return a[0]; };
const seen = new Map(), all = []; function look(o) { all.push(o); seen.set(all.length, o); return Object.keys(o).length; } function peek(o) { return (o.a ?? 0) + (o.b ?? 0) + (o.d ? 1 : 0); } function boom(v) { if (v === 3) throw new Error("three"); return v; }
function make0(v) { const o = {}; o.d = [v]; if (v > 2) o.a = v + 1; else o.c = boom(v); try { o.e = boom(v); } catch (z) { o.e = -1; } o.b = v + 1; return o; }
const lib0 = { f: null }; lib0.f = function (x) { this.a = x; return (this.d ?? 0) + "|" + (this.d ?? 0); };
function read0(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.d + "," + q.c + ";";   } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make0(i)); } catch (z) { say("threw", z.message); } } try { say(read0(list)); say(read0(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib0.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read0(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
for (const o of all.slice(0, 8)) say(o, peek(o)); console.log(out.join("\n"));
})(); } catch (error) { console.log(error.constructor.name); }
try { (() => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "object" && x ? "{" + Object.keys(x).map(k => k + ":" + (typeof x[k] === "object" && x[k] ? "o" : typeof x[k] === "function" ? "f" : x[k])) + "}" : String(x)).join(" ")); return a[0]; };
const seen = new Map(), all = []; function look(o) { all.push(o); seen.set(all.length, o); return Object.keys(o).length; } function peek(o) { return (o.a ?? 0) + (o.b ?? 0) + (o.d ? 1 : 0); } function boom(v) { if (v === 3) throw new Error("three"); return v; }
function make0(v) { const o = {}; delete o.a; look(o); return o; }
const lib0 = { f: null }; lib0.f = function (x) { return (this.d ?? 0) + "|" + (this.a ?? 0); };
function read0(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.d + "," + q.d + ";";  if (q.a === undefined) continue; t += q.a; } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make0(i)); } catch (z) { say("threw", z.message); } } try { say(read0(list)); say(read0(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib0.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read0(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
function make1(v) { const o = { a: 1 }; for (let i = 0; i < 2; i++) o.e = i + v; switch (v % 3) { case 0: o.c = "s"; break; case 1: o.a = v + 1; default: o.c = 0; } o.b = v + 1; o.a = boom(v); return o; }
const lib1 = { f: null }; lib1.f = function (x) { if (this.b > 1) return (this.a ?? 0) + "|" + (this.b ?? 0); };
function read1(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.e + "," + q.c + ";";   } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make1(i)); } catch (z) { say("threw", z.message); } } try { say(read1(list)); say(read1(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib1.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read1(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
function make2(v) { const o = { a: 1, b: "t" }; o.a = 1; Object.defineProperty(o, "c", { get() { return 8; }, enumerable: true, configurable: true }); look(o); return o; }
const lib2 = { f: null }; lib2.f = function (x) { if (this.b > 1) return (this.a ?? 0) + "|" + (this.b ?? 0); };
function read2(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.a + "," + q.d + ";"; q.d = i;  } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make2(i)); } catch (z) { say("threw", z.message); } } try { say(read2(list)); say(read2(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib2.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read2(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
for (const o of all.slice(0, 8)) say(o, peek(o)); console.log(out.join("\n"));
})(); } catch (error) { console.log(error.constructor.name); }
try { (() => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "object" && x ? "{" + Object.keys(x).map(k => k + ":" + (typeof x[k] === "object" && x[k] ? "o" : typeof x[k] === "function" ? "f" : x[k])) + "}" : String(x)).join(" ")); return a[0]; };
const seen = new Map(), all = []; function look(o) { all.push(o); seen.set(all.length, o); return Object.keys(o).length; } function peek(o) { return (o.a ?? 0) + (o.b ?? 0) + (o.d ? 1 : 0); } function boom(v) { if (v === 3) throw new Error("three"); return v; }
function make0(v) { const o = { a: v }; o.b = v; const p = o; p.c = v; switch (v % 3) { case 0: o.d = "s"; break; case 1: o.b = 1; default: o.d = 0; } o.a = 1; look(o); return o; }
const lib0 = { f: null }; lib0.f = function (x) { return (this.b ?? 0) + "|" + (this.d ?? 0); };
function read0(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.b + "," + q.b + ";"; q.a = i;  } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make0(i)); } catch (z) { say("threw", z.message); } } try { say(read0(list)); say(read0(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib0.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read0(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
function make1(v) { const o = { a: 1, b: "t" }; o.e = v + 1; switch (v % 3) { case 0: o.b = v; break; case 1: o.a = [v]; default: o.b = 0; } if (v > 2) o.a = null; look(o); return o; }
const lib1 = { f: null }; lib1.f = function (x) { this.a = x; return (this.e ?? 0) + "|" + (this.d ?? 0); };
function read1(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.e + "," + q.e + ";";   } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make1(i)); } catch (z) { say("threw", z.message); } } try { say(read1(list)); say(read1(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib1.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read1(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
for (const o of all.slice(0, 8)) say(o, peek(o)); console.log(out.join("\n"));
})(); } catch (error) { console.log(error.constructor.name); }
try { (() => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "object" && x ? "{" + Object.keys(x).map(k => k + ":" + (typeof x[k] === "object" && x[k] ? "o" : typeof x[k] === "function" ? "f" : x[k])) + "}" : String(x)).join(" ")); return a[0]; };
const seen = new Map(), all = []; function look(o) { all.push(o); seen.set(all.length, o); return Object.keys(o).length; } function peek(o) { return (o.a ?? 0) + (o.b ?? 0) + (o.d ? 1 : 0); } function boom(v) { if (v === 3) throw new Error("three"); return v; }
function make0(v) { const o = { c: undefined }; for (let i = 0; i < 2; i++) o.a = i + v; o.b = v * 0.5; return o; }
const lib0 = { f: null }; lib0.f = function (x) { return (this.a ?? 0) + "|" + (this.d ?? 0); };
function read0(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.a + "," + q.b + ";";   } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make0(i)); } catch (z) { say("threw", z.message); } } try { say(read0(list)); say(read0(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib0.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read0(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
function make1(v) { const o = { a: v }; o.e = boom(v); return o; }
const lib1 = { f: null }; lib1.f = function (x) { this.a = x; return (this.e ?? 0) + "|" + (this.a ?? 0); };
function read1(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.e + "," + q.c + ";"; q.b = i;  } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make1(i)); } catch (z) { say("threw", z.message); } } try { say(read1(list)); say(read1(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib1.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read1(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
for (const o of all.slice(0, 8)) say(o, peek(o)); console.log(out.join("\n"));
})(); } catch (error) { console.log(error.constructor.name); }
try { (() => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "object" && x ? "{" + Object.keys(x).map(k => k + ":" + (typeof x[k] === "object" && x[k] ? "o" : typeof x[k] === "function" ? "f" : x[k])) + "}" : String(x)).join(" ")); return a[0]; };
const seen = new Map(), all = []; function look(o) { all.push(o); seen.set(all.length, o); return Object.keys(o).length; } function peek(o) { return (o.a ?? 0) + (o.b ?? 0) + (o.d ? 1 : 0); } function boom(v) { if (v === 3) throw new Error("three"); return v; }
function make0(v) { const o = { c: undefined }; o.d = 1; const p = o; p.a = { k: v }; o.e = v; look(o); return o; }
const lib0 = { f: null }; lib0.f = function (x) { return (this.a ?? 0) + "|" + (this.a ?? 0); };
function read0(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.d + "," + q.e + ";"; q.c = i;  } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make0(i)); } catch (z) { say("threw", z.message); } } try { say(read0(list)); say(read0(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib0.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read0(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
for (const o of all.slice(0, 8)) say(o, peek(o)); console.log(out.join("\n"));
})(); } catch (error) { console.log(error.constructor.name); }
try { (() => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "object" && x ? "{" + Object.keys(x).map(k => k + ":" + (typeof x[k] === "object" && x[k] ? "o" : typeof x[k] === "function" ? "f" : x[k])) + "}" : String(x)).join(" ")); return a[0]; };
const seen = new Map(), all = []; function look(o) { all.push(o); seen.set(all.length, o); return Object.keys(o).length; } function peek(o) { return (o.a ?? 0) + (o.b ?? 0) + (o.d ? 1 : 0); } function boom(v) { if (v === 3) throw new Error("three"); return v; }
function make0(v) { const o = { a: 1 }; o.b = null; o.c = v; return o; }
const lib0 = { f: null }; lib0.f = function (x) { if (this.b > 1) return (this.b ?? 0) + "|" + (this.a ?? 0); };
function read0(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.b + "," + q.a + ";";   } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make0(i)); } catch (z) { say("threw", z.message); } } try { say(read0(list)); say(read0(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib0.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read0(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
function make1(v) { const o = {}; o.d = { k: v }; o.c = boom(v); look(o); return o; }
const lib1 = { f: null }; lib1.f = function (x) { this.a = x; return (this.c ?? 0) + "|" + (this.c ?? 0); };
function read1(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.d + "," + q.d + ";";  if (q.a === undefined) continue; t += q.a; } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make1(i)); } catch (z) { say("threw", z.message); } } try { say(read1(list)); say(read1(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib1.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read1(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
for (const o of all.slice(0, 8)) say(o, peek(o)); console.log(out.join("\n"));
})(); } catch (error) { console.log(error.constructor.name); }
try { (() => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "object" && x ? "{" + Object.keys(x).map(k => k + ":" + (typeof x[k] === "object" && x[k] ? "o" : typeof x[k] === "function" ? "f" : x[k])) + "}" : String(x)).join(" ")); return a[0]; };
const seen = new Map(), all = []; function look(o) { all.push(o); seen.set(all.length, o); return Object.keys(o).length; } function peek(o) { return (o.a ?? 0) + (o.b ?? 0) + (o.d ? 1 : 0); } function boom(v) { if (v === 3) throw new Error("three"); return v; }
function make0(v) { const o = { a: 1 }; say(peek(o)); o.a = { k: v }; for (let i = 0; i < 2; i++) o.c = i + v; if (v > 2) o.e = v; else o.c = null; o.d = boom(v); look(o); return o; }
const lib0 = { f: null }; lib0.f = function (x) { return (this.d ?? 0) + "|" + (this.e ?? 0); };
function read0(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.a + "," + q.a + ";"; q.c = i;  } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make0(i)); } catch (z) { say("threw", z.message); } } try { say(read0(list)); say(read0(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib0.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read0(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
for (const o of all.slice(0, 8)) say(o, peek(o)); console.log(out.join("\n"));
})(); } catch (error) { console.log(error.constructor.name); }
try { (() => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "object" && x ? "{" + Object.keys(x).map(k => k + ":" + (typeof x[k] === "object" && x[k] ? "o" : typeof x[k] === "function" ? "f" : x[k])) + "}" : String(x)).join(" ")); return a[0]; };
const seen = new Map(), all = []; function look(o) { all.push(o); seen.set(all.length, o); return Object.keys(o).length; } function peek(o) { return (o.a ?? 0) + (o.b ?? 0) + (o.d ? 1 : 0); } function boom(v) { if (v === 3) throw new Error("three"); return v; }
function make0(v) { const o = { a: v }; switch (v % 3) { case 0: o.b = [v]; break; case 1: o.a = undefined; default: o.b = 0; } o.a = [v]; o.c = { k: v }; look(o); return o; }
const lib0 = { f: null }; lib0.f = function (x) { this.a = x; return (this.a ?? 0) + "|" + (this.e ?? 0); };
function read0(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.b + "," + q.b + ";";   } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make0(i)); } catch (z) { say("threw", z.message); } } try { say(read0(list)); say(read0(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib0.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read0(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
for (const o of all.slice(0, 8)) say(o, peek(o)); console.log(out.join("\n"));
})(); } catch (error) { console.log(error.constructor.name); }
try { (() => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "object" && x ? "{" + Object.keys(x).map(k => k + ":" + (typeof x[k] === "object" && x[k] ? "o" : typeof x[k] === "function" ? "f" : x[k])) + "}" : String(x)).join(" ")); return a[0]; };
const seen = new Map(), all = []; function look(o) { all.push(o); seen.set(all.length, o); return Object.keys(o).length; } function peek(o) { return (o.a ?? 0) + (o.b ?? 0) + (o.d ? 1 : 0); } function boom(v) { if (v === 3) throw new Error("three"); return v; }
function make0(v) { const o = {}; o.d = v * 0.5; look(o); return o; }
const lib0 = { f: null }; lib0.f = function (x) { if (this.b > 1) return (this.d ?? 0) + "|" + (this.d ?? 0); };
function read0(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.d + "," + q.b + ";";  if (q.a === undefined) continue; t += q.a; } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make0(i)); } catch (z) { say("threw", z.message); } } try { say(read0(list)); say(read0(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib0.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read0(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
function make1(v) { const o = {}; (() => { o.e = v; })(); switch (v % 3) { case 0: o.b = v + 1; break; case 1: o.d = [v]; default: o.b = 0; } o.c = [v]; say(peek(o)); o.d = [v]; look(o); return o; }
const lib1 = { f: null }; lib1.f = function (x) { this.a = x; return (this.c ?? 0) + "|" + (this.a ?? 0); };
function read1(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.e + "," + q.e + ";"; q.a = i;  } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make1(i)); } catch (z) { say("threw", z.message); } } try { say(read1(list)); say(read1(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib1.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read1(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
function make2(v) { const o = {}; o.c = boom(v); o.e = boom(v); switch (v % 3) { case 0: o.d = null; break; case 1: o.d = { k: v }; default: o.d = 0; } return o; }
const lib2 = { f: null }; lib2.f = function (x) { return (this.e ?? 0) + "|" + (this.a ?? 0); };
function read2(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.c + "," + q.e + ";"; q.e = i;  } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make2(i)); } catch (z) { say("threw", z.message); } } try { say(read2(list)); say(read2(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib2.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read2(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
for (const o of all.slice(0, 8)) say(o, peek(o)); console.log(out.join("\n"));
})(); } catch (error) { console.log(error.constructor.name); }
try { (() => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "object" && x ? "{" + Object.keys(x).map(k => k + ":" + (typeof x[k] === "object" && x[k] ? "o" : typeof x[k] === "function" ? "f" : x[k])) + "}" : String(x)).join(" ")); return a[0]; };
const seen = new Map(), all = []; function look(o) { all.push(o); seen.set(all.length, o); return Object.keys(o).length; } function peek(o) { return (o.a ?? 0) + (o.b ?? 0) + (o.d ? 1 : 0); } function boom(v) { if (v === 3) throw new Error("three"); return v; }
function make0(v) { const o = {}; if (v > 2) o.e = boom(v); try { o.d = boom(v); } catch (z) { o.d = -1; } o.c = boom(v); say(peek(o)); o.a = [v]; return o; }
const lib0 = { f: null }; lib0.f = function (x) { return (this.c ?? 0) + "|" + (this.e ?? 0); };
function read0(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.e + "," + q.a + ";";   } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make0(i)); } catch (z) { say("threw", z.message); } } try { say(read0(list)); say(read0(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib0.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read0(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
function make1(v) { const o = {}; delete o.a; return o; }
const lib1 = { f: null }; lib1.f = function (x) { if (this.b > 1) return (this.a ?? 0) + "|" + (this.a ?? 0); };
function read1(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.a + "," + q.e + ";"; q.c = i;  } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make1(i)); } catch (z) { say("threw", z.message); } } try { say(read1(list)); say(read1(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib1.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read1(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
function make2(v) { const o = { a: 1, b: "t" }; o.d = undefined; say(peek(o)); o.b = { k: v }; if (v > 2) o.e = undefined; return o; }
const lib2 = { f: null }; lib2.f = function (x) { return (this.b ?? 0) + "|" + (this.a ?? 0); };
function read2(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.d + "," + q.b + ";"; q.e = i;  } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make2(i)); } catch (z) { say("threw", z.message); } } try { say(read2(list)); say(read2(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib2.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read2(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
for (const o of all.slice(0, 8)) say(o, peek(o)); console.log(out.join("\n"));
})(); } catch (error) { console.log(error.constructor.name); }
try { (() => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "object" && x ? "{" + Object.keys(x).map(k => k + ":" + (typeof x[k] === "object" && x[k] ? "o" : typeof x[k] === "function" ? "f" : x[k])) + "}" : String(x)).join(" ")); return a[0]; };
const seen = new Map(), all = []; function look(o) { all.push(o); seen.set(all.length, o); return Object.keys(o).length; } function peek(o) { return (o.a ?? 0) + (o.b ?? 0) + (o.d ? 1 : 0); } function boom(v) { if (v === 3) throw new Error("three"); return v; }
function make0(v) { const o = {}; o.a = undefined; return o; }
const lib0 = { f: null }; lib0.f = function (x) { return (this.a ?? 0) + "|" + (this.d ?? 0); };
function read0(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.a + "," + q.b + ";"; q.c = i; if (q.a === undefined) continue; t += q.a; } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make0(i)); } catch (z) { say("threw", z.message); } } try { say(read0(list)); say(read0(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib0.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read0(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
for (const o of all.slice(0, 8)) say(o, peek(o)); console.log(out.join("\n"));
})(); } catch (error) { console.log(error.constructor.name); }
try { (() => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "object" && x ? "{" + Object.keys(x).map(k => k + ":" + (typeof x[k] === "object" && x[k] ? "o" : typeof x[k] === "function" ? "f" : x[k])) + "}" : String(x)).join(" ")); return a[0]; };
const seen = new Map(), all = []; function look(o) { all.push(o); seen.set(all.length, o); return Object.keys(o).length; } function peek(o) { return (o.a ?? 0) + (o.b ?? 0) + (o.d ? 1 : 0); } function boom(v) { if (v === 3) throw new Error("three"); return v; }
function make0(v) { const o = { a: 1, b: "t" }; const p = o; p.a = [v]; o.b = { k: v }; look(o); return o; }
const lib0 = { f: null }; lib0.f = function (x) { return (this.a ?? 0) + "|" + (this.d ?? 0); };
function read0(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.a + "," + q.c + ";";   } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make0(i)); } catch (z) { say("threw", z.message); } } try { say(read0(list)); say(read0(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib0.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read0(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
for (const o of all.slice(0, 8)) say(o, peek(o)); console.log(out.join("\n"));
})(); } catch (error) { console.log(error.constructor.name); }
try { (() => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "object" && x ? "{" + Object.keys(x).map(k => k + ":" + (typeof x[k] === "object" && x[k] ? "o" : typeof x[k] === "function" ? "f" : x[k])) + "}" : String(x)).join(" ")); return a[0]; };
const seen = new Map(), all = []; function look(o) { all.push(o); seen.set(all.length, o); return Object.keys(o).length; } function peek(o) { return (o.a ?? 0) + (o.b ?? 0) + (o.d ? 1 : 0); } function boom(v) { if (v === 3) throw new Error("three"); return v; }
function make0(v) { const o = { c: undefined }; const p = o; p.b = "s"; o.d = v + 1; look(o); return o; }
const lib0 = { f: null }; lib0.f = function (x) { this.a = x; return (this.d ?? 0) + "|" + (this.b ?? 0); };
function read0(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.b + "," + q.b + ";";   } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make0(i)); } catch (z) { say("threw", z.message); } } try { say(read0(list)); say(read0(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib0.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read0(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
for (const o of all.slice(0, 8)) say(o, peek(o)); console.log(out.join("\n"));
})(); } catch (error) { console.log(error.constructor.name); }
try { (() => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "object" && x ? "{" + Object.keys(x).map(k => k + ":" + (typeof x[k] === "object" && x[k] ? "o" : typeof x[k] === "function" ? "f" : x[k])) + "}" : String(x)).join(" ")); return a[0]; };
const seen = new Map(), all = []; function look(o) { all.push(o); seen.set(all.length, o); return Object.keys(o).length; } function peek(o) { return (o.a ?? 0) + (o.b ?? 0) + (o.d ? 1 : 0); } function boom(v) { if (v === 3) throw new Error("three"); return v; }
function make0(v) { const o = {}; for (let i = 0; i < 2; i++) o.a = i + v; return o; }
const lib0 = { f: null }; lib0.f = function (x) { this.a = x; return (this.a ?? 0) + "|" + (this.d ?? 0); };
function read0(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.a + "," + q.b + ";";  if (q.a === undefined) continue; t += q.a; } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make0(i)); } catch (z) { say("threw", z.message); } } try { say(read0(list)); say(read0(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib0.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read0(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
for (const o of all.slice(0, 8)) say(o, peek(o)); console.log(out.join("\n"));
})(); } catch (error) { console.log(error.constructor.name); }
try { (() => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "object" && x ? "{" + Object.keys(x).map(k => k + ":" + (typeof x[k] === "object" && x[k] ? "o" : typeof x[k] === "function" ? "f" : x[k])) + "}" : String(x)).join(" ")); return a[0]; };
const seen = new Map(), all = []; function look(o) { all.push(o); seen.set(all.length, o); return Object.keys(o).length; } function peek(o) { return (o.a ?? 0) + (o.b ?? 0) + (o.d ? 1 : 0); } function boom(v) { if (v === 3) throw new Error("three"); return v; }
function make0(v) { const o = {}; (() => { o.c = v + 1; })(); (() => { o.d = v * 0.5; })(); o.a = null; const p = o; p.e = null; look(o); return o; }
const lib0 = { f: null }; lib0.f = function (x) { return (this.a ?? 0) + "|" + (this.b ?? 0); };
function read0(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.c + "," + q.c + ";";  if (q.a === undefined) continue; t += q.a; } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make0(i)); } catch (z) { say("threw", z.message); } } try { say(read0(list)); say(read0(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib0.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read0(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
function make1(v) { const o = { a: v }; const p = o; p.d = v * 0.5; o.c = [v]; if (v > 2) o.e = v; o.a = v; look(o); return o; }
const lib1 = { f: null }; lib1.f = function (x) { this.a = x; return (this.e ?? 0) + "|" + (this.b ?? 0); };
function read1(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.d + "," + q.b + ";";   } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make1(i)); } catch (z) { say("threw", z.message); } } try { say(read1(list)); say(read1(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib1.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read1(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
function make2(v) { const o = { a: 1, b: "t" }; Object.defineProperty(o, "c", { get() { return 8; }, enumerable: true, configurable: true }); (() => { o.b = 1; })(); o.e = { k: v }; if (v == 4) Object.freeze(o); look(o); return o; }
const lib2 = { f: null }; lib2.f = function (x) { if (this.b > 1) return (this.b ?? 0) + "|" + (this.d ?? 0); };
function read2(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.d + "," + q.d + ";";   } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make2(i)); } catch (z) { say("threw", z.message); } } try { say(read2(list)); say(read2(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib2.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read2(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
for (const o of all.slice(0, 8)) say(o, peek(o)); console.log(out.join("\n"));
})(); } catch (error) { console.log(error.constructor.name); }
try { (() => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "object" && x ? "{" + Object.keys(x).map(k => k + ":" + (typeof x[k] === "object" && x[k] ? "o" : typeof x[k] === "function" ? "f" : x[k])) + "}" : String(x)).join(" ")); return a[0]; };
const seen = new Map(), all = []; function look(o) { all.push(o); seen.set(all.length, o); return Object.keys(o).length; } function peek(o) { return (o.a ?? 0) + (o.b ?? 0) + (o.d ? 1 : 0); } function boom(v) { if (v === 3) throw new Error("three"); return v; }
function make0(v) { const o = {}; look(o); o.b = null; const p = o; p.a = v * 0.5; look(o); return o; }
const lib0 = { f: null }; lib0.f = function (x) { if (this.b > 1) return (this.b ?? 0) + "|" + (this.d ?? 0); };
function read0(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.b + "," + q.a + ";"; q.e = i; if (q.a === undefined) continue; t += q.a; } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make0(i)); } catch (z) { say("threw", z.message); } } try { say(read0(list)); say(read0(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib0.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read0(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
function make1(v) { const o = { a: 1, b: "t" }; if (v > 2) o.b = null; o.e = v + 1; return o; }
const lib1 = { f: null }; lib1.f = function (x) { if (this.b > 1) return (this.e ?? 0) + "|" + (this.e ?? 0); };
function read1(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.b + "," + q.e + ";"; q.e = i;  } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make1(i)); } catch (z) { say("threw", z.message); } } try { say(read1(list)); say(read1(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib1.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read1(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
for (const o of all.slice(0, 8)) say(o, peek(o)); console.log(out.join("\n"));
})(); } catch (error) { console.log(error.constructor.name); }
try { (() => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "object" && x ? "{" + Object.keys(x).map(k => k + ":" + (typeof x[k] === "object" && x[k] ? "o" : typeof x[k] === "function" ? "f" : x[k])) + "}" : String(x)).join(" ")); return a[0]; };
const seen = new Map(), all = []; function look(o) { all.push(o); seen.set(all.length, o); return Object.keys(o).length; } function peek(o) { return (o.a ?? 0) + (o.b ?? 0) + (o.d ? 1 : 0); } function boom(v) { if (v === 3) throw new Error("three"); return v; }
function make0(v) { const o = { a: 1, b: "t" }; const p = o; p.a = [v]; return o; }
const lib0 = { f: null }; lib0.f = function (x) { this.a = x; return (this.a ?? 0) + "|" + (this.b ?? 0); };
function read0(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.a + "," + q.b + ";"; q.e = i;  } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make0(i)); } catch (z) { say("threw", z.message); } } try { say(read0(list)); say(read0(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib0.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read0(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
for (const o of all.slice(0, 8)) say(o, peek(o)); console.log(out.join("\n"));
})(); } catch (error) { console.log(error.constructor.name); }
try { (() => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "object" && x ? "{" + Object.keys(x).map(k => k + ":" + (typeof x[k] === "object" && x[k] ? "o" : typeof x[k] === "function" ? "f" : x[k])) + "}" : String(x)).join(" ")); return a[0]; };
const seen = new Map(), all = []; function look(o) { all.push(o); seen.set(all.length, o); return Object.keys(o).length; } function peek(o) { return (o.a ?? 0) + (o.b ?? 0) + (o.d ? 1 : 0); } function boom(v) { if (v === 3) throw new Error("three"); return v; }
function make0(v) { const o = {}; const p = o; p.d = [v]; return o; }
const lib0 = { f: null }; lib0.f = function (x) { return (this.d ?? 0) + "|" + (this.d ?? 0); };
function read0(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.d + "," + q.c + ";"; q.c = i; if (q.a === undefined) continue; t += q.a; } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make0(i)); } catch (z) { say("threw", z.message); } } try { say(read0(list)); say(read0(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib0.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read0(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
for (const o of all.slice(0, 8)) say(o, peek(o)); console.log(out.join("\n"));
})(); } catch (error) { console.log(error.constructor.name); }
try { (() => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "object" && x ? "{" + Object.keys(x).map(k => k + ":" + (typeof x[k] === "object" && x[k] ? "o" : typeof x[k] === "function" ? "f" : x[k])) + "}" : String(x)).join(" ")); return a[0]; };
const seen = new Map(), all = []; function look(o) { all.push(o); seen.set(all.length, o); return Object.keys(o).length; } function peek(o) { return (o.a ?? 0) + (o.b ?? 0) + (o.d ? 1 : 0); } function boom(v) { if (v === 3) throw new Error("three"); return v; }
function make0(v) { const o = {}; o.d = 1; return o; }
const lib0 = { f: null }; lib0.f = function (x) { this.a = x; return (this.d ?? 0) + "|" + (this.e ?? 0); };
function read0(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.d + "," + q.e + ";"; q.e = i;  } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make0(i)); } catch (z) { say("threw", z.message); } } try { say(read0(list)); say(read0(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib0.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read0(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
function make1(v) { const o = { a: 1 }; Object.setPrototypeOf(o, { set b(z) { out.push("set b"); }, get b() { return 7; } }); o.c = v * 0.5; if (v > 2) o.b = [v]; for (let i = 0; i < 2; i++) o.e = i + v; return o; }
const lib1 = { f: null }; lib1.f = function (x) { if (this.b > 1) return (this.b ?? 0) + "|" + (this.b ?? 0); };
function read1(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.a + "," + q.d + ";";   } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make1(i)); } catch (z) { say("threw", z.message); } } try { say(read1(list)); say(read1(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib1.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read1(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
for (const o of all.slice(0, 8)) say(o, peek(o)); console.log(out.join("\n"));
})(); } catch (error) { console.log(error.constructor.name); }
try { (() => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "object" && x ? "{" + Object.keys(x).map(k => k + ":" + (typeof x[k] === "object" && x[k] ? "o" : typeof x[k] === "function" ? "f" : x[k])) + "}" : String(x)).join(" ")); return a[0]; };
const seen = new Map(), all = []; function look(o) { all.push(o); seen.set(all.length, o); return Object.keys(o).length; } function peek(o) { return (o.a ?? 0) + (o.b ?? 0) + (o.d ? 1 : 0); } function boom(v) { if (v === 3) throw new Error("three"); return v; }
function make0(v) { const o = { a: 1, b: "t" }; o.d = v + 1; look(o); return o; }
const lib0 = { f: null }; lib0.f = function (x) { this.a = x; return (this.d ?? 0) + "|" + (this.d ?? 0); };
function read0(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.d + "," + q.e + ";"; q.a = i; if (q.a === undefined) continue; t += q.a; } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make0(i)); } catch (z) { say("threw", z.message); } } try { say(read0(list)); say(read0(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib0.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read0(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
for (const o of all.slice(0, 8)) say(o, peek(o)); console.log(out.join("\n"));
})(); } catch (error) { console.log(error.constructor.name); }
try { (() => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "object" && x ? "{" + Object.keys(x).map(k => k + ":" + (typeof x[k] === "object" && x[k] ? "o" : typeof x[k] === "function" ? "f" : x[k])) + "}" : String(x)).join(" ")); return a[0]; };
const seen = new Map(), all = []; function look(o) { all.push(o); seen.set(all.length, o); return Object.keys(o).length; } function peek(o) { return (o.a ?? 0) + (o.b ?? 0) + (o.d ? 1 : 0); } function boom(v) { if (v === 3) throw new Error("three"); return v; }
function make0(v) { const o = {}; o.b = null; o.e = v * 0.5; look(o); return o; }
const lib0 = { f: null }; lib0.f = function (x) { this.a = x; return (this.e ?? 0) + "|" + (this.b ?? 0); };
function read0(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.b + "," + q.b + ";"; q.a = i;  } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make0(i)); } catch (z) { say("threw", z.message); } } try { say(read0(list)); say(read0(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib0.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read0(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
function make1(v) { const o = { a: 1 }; o.d = "s"; if (v > 2) o.c = v; return o; }
const lib1 = { f: null }; lib1.f = function (x) { if (this.b > 1) return (this.d ?? 0) + "|" + (this.e ?? 0); };
function read1(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.d + "," + q.c + ";";  if (q.a === undefined) continue; t += q.a; } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make1(i)); } catch (z) { say("threw", z.message); } } try { say(read1(list)); say(read1(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib1.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read1(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
function make2(v) { const o = { a: 1, b: "t" }; look(o); o.b = null; for (let i = 0; i < 2; i++) o.c = i + v; if (v > 2) o.e = undefined; else o.c = 1; try { o.a = boom(v); } catch (z) { o.a = -1; } look(o); return o; }
const lib2 = { f: null }; lib2.f = function (x) { this.a = x; return (this.c ?? 0) + "|" + (this.e ?? 0); };
function read2(list) { let t = ""; for (let i = 0; i < list.length; i++) { const q = list[i]; t += q.b + "," + q.d + ";";   } return t; }
{ const list = []; for (let i = 0; i < 6; i++) { try { list.push(make2(i)); } catch (z) { say("threw", z.message); } } try { say(read2(list)); say(read2(all)); } catch (z) { say("read", z instanceof TypeError); } for (const o of list) { say(o); say({ ...o }); o.f = lib2.f; try { say(o.f(2)); } catch (z) { say("f", z instanceof TypeError); } } try { say(read2(list)); say(JSON.stringify(list)); } catch (z) { say("again", z instanceof TypeError); } }
for (const o of all.slice(0, 8)) say(o, peek(o)); console.log(out.join("\n"));
})(); } catch (error) { console.log(error.constructor.name); }
