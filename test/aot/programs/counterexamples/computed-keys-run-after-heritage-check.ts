// A heritage clause that is no constructor throws before any computed member name is evaluated.
declare const console: { log(...a: unknown[]): void };
let keys = 0;
try { class C extends (5 as any) { [keys++]() {} } } catch {}
console.log(keys);
