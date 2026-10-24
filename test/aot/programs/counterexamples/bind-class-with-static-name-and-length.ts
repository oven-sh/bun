// `C.bind(..)` takes its name and length from `static name` and `static get length`.
declare const console: { log(...a: unknown[]): void };
class A { static name = "n"; }
class B { static get length() { return 5; } }
console.log(A.bind(null).name, B.bind(null).length);
