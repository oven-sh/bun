// A method whose `this` is declared `any` reads a field that holds a function: a new one for each instance.
declare const console: { log(...a: unknown[]): void };
class K { f = () => 1; peek(this: any) { return this.f; } }
console.log(new K().peek() === new K().peek());
