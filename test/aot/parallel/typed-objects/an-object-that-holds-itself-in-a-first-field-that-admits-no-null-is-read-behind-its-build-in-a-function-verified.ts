// Flags: --aot-check=verify-each-pass
// The object is first needed at the loose comparison. Its first field holds the object itself and admits neither null nor undefined, so the allocation lists nothing and three stores stand directly behind it.
class C { self: C = this; a = 0; b = 0; }
function f() { const o = new C(); try { o.a = ((o.self !== o) && 1) || 2; } catch { o.a = 9; } o.b = ((o.self != o) && 3) || 4; return o.a + "," + o.b; }
console.log(f(), f(), f());
export {};
