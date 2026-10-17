// `array.push(i)` in the test of a counted loop.
declare const console: { log(...a: unknown[]): void };
const a = [9]; for (let i = 0; a.push(i), i < 1; i++);
console.log(a.join());
