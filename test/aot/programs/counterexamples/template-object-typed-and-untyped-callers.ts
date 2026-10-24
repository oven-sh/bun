// A tagged template has one template object, whether its function is called with a typed or an untyped argument.
declare const console: { log(...a: unknown[]): void };
const id = (s: TemplateStringsArray) => s;
function f(p: { x: number }) { return id`a`; }
const g: any = f;
console.log(f({ x: 1 }) === g(JSON.parse('{"x":1}')));
