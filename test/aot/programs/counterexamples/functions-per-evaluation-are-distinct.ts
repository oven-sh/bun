// Two calls of a function that returns `{ f: () => 1 }` out of a local variable yield two function objects.
declare const console: { log(...a: unknown[]): void };
const g: () => any = () => { const o = { f: () => 1 }; return o; };
console.log(g().f === g().f);
