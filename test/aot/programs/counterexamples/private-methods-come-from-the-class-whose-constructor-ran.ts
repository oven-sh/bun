// `Reflect.construct(A, [], B)` makes an object with the private methods of A.
declare const console: { log(...a: unknown[]): void };
function make(n: number) {
  return class P { #m() { return n; } static ask(o: P) { return o.#m(); } };
}
const A = make(1);
console.log(A.ask(new A()), A.ask(Reflect.construct(A, [], make(2))));
