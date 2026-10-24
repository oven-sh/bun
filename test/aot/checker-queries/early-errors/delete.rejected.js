// delete of a private member, and in strict mode code delete of a name, with or without parentheses.
class C { #a; m() { delete this.#a; } }
class C { #a; m() { delete (this.#a); } }
class C { #a; m(o) { delete o?.#a; } }
var a; delete a;
var a; delete (a);
var a; delete ((a));
