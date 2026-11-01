export class A { #f = () => 1; static s = () => 2; static #t = () => 3; call() { return this.#f() + A.#t(); } same() { return this.#f === this.#f; } }
