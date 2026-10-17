// `Object.assign({}, { ["__proto__"]: null })` stores `__proto__`, which sets the prototype and defines nothing.
declare const console: { log(...a: unknown[]): void };
console.log(Object.keys(Object.assign({}, { ["__proto__"]: null })).join());
