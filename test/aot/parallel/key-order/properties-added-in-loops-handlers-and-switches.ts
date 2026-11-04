type P = { a: number; b?: number; c?: number; d?: number };
function show(o: object): string { return Object.keys(o).join("") + ":" + JSON.stringify(o); }
function inLoop(n: number): string { const p: P = { a: 1 }; for (let i = 0; i < n; i++) p.b = i; const s = { ...p }; return show(s) + show(p); }
function inLoopThenStore(n: number): string { const p: P = { a: 1 }; for (let i = 0; i < n; i++) p.c = i; p.b = 5; p.d = 6; return show(p); }
function storeInLoopTwice(n: number): string { const p: P = { a: 1 }; for (let i = 0; i < n; i++) { p.d = i; p.b = i; } p.c = 1; return show(p); }
function alternating(n: number): string { const p: P = { a: 1 }; for (let i = 0; i < n; i++) { if (i & 1) p.b = i; else p.c = i; } p.d = 1; return show(p); }
function caught(fails: boolean): string { const p: P = { a: 1 }; try { if (fails) throw 1; p.c = 2; } catch { } const s = { ...p }; p.b = 1; return show(s) + show(p); }
function caughtBetween(fails: boolean): string { const p: P = { a: 1 }; try { p.d = 2; if (fails) throw 1; p.c = 2; } catch { p.b = 3; } p.c = 4; return show(p); }
function finallyStores(fails: boolean): string { const p: P = { a: 1 }; try { try { if (fails) throw 1; p.b = 1; } finally { p.c = 2; } } catch { } p.d = 3; return show(p); }
function switched(k: number): string { const p: P = { a: 1 }; switch (k) { case 0: p.b = 1; case 1: p.c = 1; break; case 2: p.d = 1; } p.b = 2; p.c = 2; p.d = 2; return show(p); }
function conditional(k: number): string { const p: P = { a: 1 }; k & 1 && (p.d = 1); k & 2 ? (p.b = 1) : (p.c = 1); p.d = 9; return show(p); }
function twoObjects(k: number): string { const p: P = { a: 1 }; const q: P = { a: 2 }; const r = k ? p : q; r.b = 1; p.c = 1; q.d = 1; return show(p) + show(q); }
function nestedLoops(n: number): string { const p: P = { a: 1 }; for (let i = 0; i < n; i++) { for (let j = 0; j < i; j++) p.d = j; p.b = i; } p.c = 0; return show(p); }
function deleted(k: number): string { const p: P = { a: 1, b: 2 }; if (k) delete p.b; p.c = 1; p.b = 3; return show(p); }
class Box { x: number; y?: number; z?: number; constructor(x: number, k: number) { this.x = x; if (k & 1) this.z = 1; if (k & 2) this.y = 2; for (let i = 0; i < k; i++) this.z = i; } }
function Old(this: any, k: number) { this.a = 1; if (k & 1) this.c = 1; this.b = 2; for (let i = 0; i < k; i++) this.d = i; this.c = 3; }
for (let k = 0; k < 4; k++) {
  console.log(k, inLoop(k), inLoopThenStore(k), storeInLoopTwice(k), alternating(k), caught(!!(k & 1)), caughtBetween(!!(k & 1)), finallyStores(!!(k & 1)));
  console.log(k, switched(k), conditional(k), twoObjects(k & 1), nestedLoops(k), deleted(k & 1), show(new Box(1, k)), show(new (Old as any)(k)));
}
