// An anonymous function behind `as` is named after the const that it initializes.
declare const console: { log(...a: unknown[]): void };
const a = (() => {}) as () => void;
console.log(JSON.stringify(a.name));
