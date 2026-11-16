// answers: with-library
// # a name that is stored on an object behind its construction has a slot, wherever the plan lays it. The keys are listed in the order in which each object got them: keys, for in, JSON.stringify, entries, a spread, on instances of a class, of a constructor function and on literals, with unknown and with proven receivers
// # At the end the shell runs the same text itself: every answer is the same.
// # LIBRARY: own
// # RUN: run-in-shell $SHELL
// # CHECK: 55 of 55 of 55
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
class P { x: number; constructor(x: number) { this.x = x; } }
function Box(this: any, id: number) { this.id = id; }
function fill(o: any, turn: number) { switch (turn % 6) { case 0: o.a = 1; o.b = "two"; o.c = true; break; case 1: o.c = false; o.b = "b"; o.a = 2; break; case 2: o.b = "only"; break; case 3: o.e = 5; o.a = 3; o.d = null; o.c = true; o.b = "x"; break; case 4: break; case 5: o.d = 7; o.a = 1.5; break; } }
function list(o: any) { let byForIn = ""; for (const k in o) byForIn += k + ","; const spread = { ...o }; let entries = ""; for (const e of Object.entries(o)) entries += e[0] + "=" + String(e[1]) + ","; return Object.keys(o).join(",") + "|" + byForIn + "|" + JSON.stringify(o) + "|" + entries + "|" + Object.keys(spread).join(",") + "|" + Object.getOwnPropertyNames(o).join(",") + "|" + Object.values(o).length; }
for (let turn = 0; turn < 12; turn++) { const p = new P(turn); fill(p, turn); report(list(p)); const box = new (Box as any)(turn); fill(box, turn + 1); report(list(box)); const literal = { id: turn, z: "z" }; fill(literal, turn + 2); report(list(literal)); }
class Q { x = 0; }
function addKnown(q: Q, turn: number) { const o = q as any; if (turn % 3 === 0) { o.a = turn; o.b = "b" + turn; } else if (turn % 3 === 1) { o.b = "c" + turn; o.a = turn * 2; } else o.b = "only"; }
function keysKnown(q: Q) { let s = ""; for (const k in q) s += k + ","; return s + "|" + Object.keys(q).join(","); }
function readKnown(q: Q) { const o = q as any; return String(o.x) + ":" + String(o.a) + ":" + String(o.b) + ":" + String(o.never) + ":" + ("a" in o) + ":" + ("never" in o); }
for (let turn = 0; turn < 9; turn++) { const q = new Q(); report(readKnown(q)); addKnown(q, turn); report(readKnown(q) + ";" + keysKnown(q)); }
report("end");
