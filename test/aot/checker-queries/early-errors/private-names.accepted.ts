// Private names that the body of an enclosing class declares, also from the heritage clause of an inner class. Checked or not.
export class C { #a = 1; m(o: C) { return o.#a; } }
export class C { #a = 1; static is(o: object) { return #a in o; } }
export class D { #a = Object; m(o: D) { return class extends (o.#a) {}; } }
export class D { #a = 1; m(o: object) { return class extends (#a in o ? Object : Array) {}; } }
⏎// @ts-nocheck⏎export class D { #a; m(o) { class C extends (o.#a) { #a; } } }
⏎// @ts-nocheck⏎export class D { #a; m(o) { class C extends (#a in o ? Object : Array) { #a; } } }
