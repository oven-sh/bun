// Private names that an enclosing class declares, before or after the use.
class C { #a; m() { this.#a; } }
class C { #a; m() { #a in this; } }
class C { #a; m() { class D { n(o) { o.#a; } } } }
class C { m() { this.#a; } #a; }
class C { #a; m(o) { o?.#a; } }
class C { static #a; static m() { C.#a; } }
class C { #a() {} m() { this.#a(); } }
class D { #a; m(o) { class C extends (o.#a) { #a; } } }
class D { #a; m(o) { class C extends (o.#a) {} } }
class D { #a; m(o) { #a in o; class C extends (o.#a) { #a; } } }
class D { #a; m(o) { class C extends (#a in o ? Object : Array) { #a; } } }
class D { #a; m() { class C extends class { n(o) { o.#a; } } { #a; } } }
class C { #a; [C.#a]() {} }
