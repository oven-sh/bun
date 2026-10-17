// `static x = this.#a` in a class that a function returns.
function f() { return class { static #a = 1; static x = this.#a; }; }
console.log(f().x);
