// `const [x, ...z] = R` over `unknown[]`.
declare const console: { log(...a: unknown[]): void };
console.log(((R: unknown[]) => { const [x, ...z] = R; return z; })([1, 2, 3]).length);
