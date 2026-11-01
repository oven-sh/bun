// Flags: --aot-check=verify-each-pass
// The object is first needed at the loose comparison. A field that waits for its own object is listed with null until the store, so that the allocation lists every field.
class C { self: C | null = null; a = 0; b = 0; }
function f() { const o = new C(); o.self = o; try { o.a = ((o.self !== o) && 1) || 2; } catch { o.a = 9; } o.b = ((o.self != o) && 3) || 4; return o.a + "," + o.b; }
console.log(f(), f(), f());
export {};
