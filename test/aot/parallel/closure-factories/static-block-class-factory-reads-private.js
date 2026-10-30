// A class expression that a function returns has a private static field, and its static block reads the field.
const make = () => class { static #c = 1; static { this.t = this.#c; } };
class S extends make() {}
console.log(S.t);
