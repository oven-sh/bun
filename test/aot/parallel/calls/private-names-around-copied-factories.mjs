// A copy stands outside the class whose private names the factory reads.
const say = (...all) => console.log(...all);
const attempt = run => { try { return run(); } catch (error) { return error.name; } };
let read, write, has, call, counted, shared, constructed, own, both;
class Vault {
  #secret = 1; #log = [];
  static #count = 0;
  #seal(by) { return (this.#secret += by); }
  get #shown() { return "<" + this.#secret + ">"; }
  open() {
    read = () => class { read(it) { return it.#secret; } shown(it) { return it?.#shown; } };
    write = P => class extends P { write(it, to) { it.#secret = to; it.#secret++; return it.#secret; } };
    has = P => class extends P { has(it) { return #secret in it; } };
    call = function (P) { return class extends P { call(it, by) { return it.#seal(by); } }; };
    counted = P => class extends P { static made = ++Vault.#count; count() { return Vault.#count; } };
    shared = P => class extends (#secret in this ? P : Object) {};
    constructed = by => function (it) { this.sum = it.#secret + by; it.#log.push(by); this.log = it.#log.length; };
    own = P => class extends P { #secret = 70; #more = 7; own() { return this.#secret + this.#more; } };
    both = P => class extends P { #more = 7; both(it) { return this.#more + it.#secret; } };
  }
}
const vault = new Vault(); vault.open();
const A = read(), B = read();
say(new A().read(vault), new B().read(vault), new A().shown(vault), new B().shown(undefined), attempt(() => new A().read({})));
const C = write(Object), D = write(Array);
say(new C().write(vault, 10), new D().write(vault, 20), new A().read(vault), attempt(() => new C().write({}, 1)));
class E extends has(Object) {}
class F extends has(Map) {}
say(new E().has(vault), new F().has({}), new F().has(new Vault()));
const G = call(Object), H = call(Set);
say(new G().call(vault, 5), new H().call(vault, 6));
const I = counted(Object), J = counted(Array), K = counted(Map);
say(I.made, J.made, K.made, new I().count());
const L = shared(Map), M = shared(Set);
say(Object.getPrototypeOf(L).name, Object.getPrototypeOf(M).name);
const N = constructed(1), O = constructed(100);
say(JSON.stringify(new N(vault)), JSON.stringify(new O(vault)), attempt(() => new N({})));
const P = own(Object), Q = own(Array), R = ((x) => both(x))(Object), S = both(Array);
say(new P().own(), new Q().own(), new R().both(vault), new S().both(vault));
