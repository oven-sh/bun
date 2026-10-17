// `(n++, Object).assign({}, {})` evaluates the comma expression.
declare const console: { log(...a: unknown[]): void };
let n = 0;
(n++, Object).assign({}, {});
console.log(n);
