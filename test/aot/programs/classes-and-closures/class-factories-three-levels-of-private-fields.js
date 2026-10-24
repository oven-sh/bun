// Three levels of classes, the lower two created by functions that run more than once, each with a private field.
class A { #a = 1; a() { return this.#a; } static has(o) { return #a in o; } }
function first() { return class extends A { #b = "two"; b() { return this.#b; } static has(o) { return #b in o; } }; }
function second(B) { return class extends B { #c = [3]; x = 4; c() { return this.#c[0]; } static has(o) { return #c in o; } }; }
const B1 = first(), B2 = first(), C1 = second(B1), C2 = second(B2), C3 = second(B1);
const list = [new A, new B1, new B2, new C1, new C2, new C3];
for (let i = 0; i < list.length; ++i) {
    const o = list[i];
    console.log(i, o.a(), A.has(o), B1.has(o), B2.has(o), C1.has(o), C2.has(o), C3.has(o), B1.has(o) || B2.has(o) ? o.b() : "-", "x" in o ? o.c() + o.x : "-", Object.keys(o).join());
}
