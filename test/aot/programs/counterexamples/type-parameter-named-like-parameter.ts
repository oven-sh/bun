// A type parameter that has the name of a parameter does not hide the uses of the parameter.
declare const console: { log(...a: unknown[]): void };
function self<f>(f: () => void) { return f; }
const make = () => self(() => {});
console.log(make() === make());
