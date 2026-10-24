// JavaScript: a static private method is one function per evaluation of the class.
const make = n => class C {
  static #m() { return n; }
  static #k() {}
  static same() { return C.#m === C.#m; }
  static k() { return C.#k; }
};
console.log(make(1).same(), make(1).k() === make(1).k());
