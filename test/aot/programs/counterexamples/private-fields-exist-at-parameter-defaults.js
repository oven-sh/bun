// A private field is on `this` when the default of the constructor's parameter reads it.
class A { #p = 7; constructor(a = this.#p) { console.log(a); } }
try { new A(); } catch (e) { console.log(e.name); }
