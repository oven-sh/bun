// Flags: --aot-validate
class C { self: C = this; a = 0; b = 0; }
class Maker { make() { const o = new C(); try { o.a = ((o.self !== o) && 1) || 2; } catch { o.a = 9; } o.b = ((o.self != o) && 3) || 4; return o.a + "," + o.b; } }
const maker = new Maker();
console.log(maker.make(), maker.make(), maker.make());
export {};
