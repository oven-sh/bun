// Flags: --aot-check=verify-each-pass
// The order of the keys is that of the class, whoever is handed the object.
class C { self: C = this; a = 0; b = 0; }
function f(n: number) { const o = new C(); o.a = n; const keys = Object.keys(o).join(); return keys + " " + (o.self === o) + " " + o.a + " " + o.b; }
console.log(f(1), f(2));
export {};
