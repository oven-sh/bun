// A private name that no enclosing class declares, or in a position that does not allow one.
this.#a;
class C { m() { this.#a; } }
class C { #a; m() { class D { n() { this.#b; } } } }
class C { #a; m() { #b in this; } }
#a in {};
class C { #a; m() { super.#a; } }
class C { #a; m() { #a; } }
({ #a: 1 });
class C { #a; } new C().#a;
class C extends (o.#a) { #a; }
class C extends (#a in o ? Object : Array) { #a; }
class C extends class { m(o) { o.#a; } } { #a; }
