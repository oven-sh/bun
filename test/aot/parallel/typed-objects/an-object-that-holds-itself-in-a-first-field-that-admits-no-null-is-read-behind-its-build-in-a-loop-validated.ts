// Flags: --aot-validate
class C { self: C = this; a = 0; b = 0; }
function f(n: number) { let sum = 0; for (let i = 0; i < n; i++) { const o = new C(); try { o.a = ((o.self !== o) && 1) || 2; } catch { o.a = 9; } o.b = ((o.self != o) && 3) || 4; sum += o.a + o.b; } return sum; }
console.log(f(10), f(100));
export {};
