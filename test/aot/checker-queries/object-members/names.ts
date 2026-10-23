// A member name prints as its text, a symbol as `[symbol]`, a private name as written. A name that is an array index prints like any name.
interface Names { 0: string; "01": string; [Symbol.toStringTag]: string }
let n: Names;
class P { #x: number = 1; read() { return this.#x; } }
let p: P;
export {};
