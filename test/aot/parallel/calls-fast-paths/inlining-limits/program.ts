// IR= 1 throughNew CallDirect
// IR= 0 throughGetters CallDirect
// IR= 2 guarded CallDirect
// IR= 0 usual CallDirect
declare const console: any;
class C7 { v = 7; }
class C6 { c: C7; constructor() { this.c = new C7(); } }
class C5 { c: C6; constructor() { this.c = new C6(); } }
class C4 { c: C5; constructor() { this.c = new C5(); } }
class C3 { c: C4; constructor() { this.c = new C4(); } }
class C2 { c: C3; constructor() { this.c = new C3(); } }
class C1 { c: C2; constructor() { this.c = new C2(); } }
function throughNew() { return new C1().c.c.c.c.c.c.v; }
class G { n = 1;
    get g7() { return this.n + 7; } get g6() { return this.g7 + 6; } get g5() { return this.g6 + 5; } get g4() { return this.g5 + 4; }
    get g3() { return this.g4 + 3; } get g2() { return this.g3 + 2; } get g1() { return this.g2 + 1; } }
function throughGetters(g: G) { return g.g1; }
function describe(x: number) { return "bad value " + x; }
function fail(message: string): never { throw new Error(message); }
function guarded(x: number) { if (x < 0) fail(describe(x)); return x + 1; }
function half(x: number) { return x / 2; }
function twice(x: number) { return x * 2; }
function usual(x: number) { return x > 10 ? half(x) : twice(x); }
const g = new G();
let s = 0;
for (let i = 0; i < 1_000_000; i++) s += throughNew() + throughGetters(g) + guarded(i) + usual(i & 15);
// Called once outside any loop too: top-level code that runs once takes nothing in, so the function keeps a body for the expectations to look at.
s += throughNew() + throughGetters(g) + usual(3);
try { guarded(-1); } catch (e: any) { console.log(e.message); }
console.log(s);
export {};
