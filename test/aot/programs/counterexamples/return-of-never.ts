// `return [][0]` returns though its static type is `never`.
declare const console: { log(...a: unknown[]): void };
function pick(a: { n: number }, c: boolean): { n: number } { if (c) return [][0]; return a; }
console.log(pick({ n: 1 }, true) === undefined);
