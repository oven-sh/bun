globalThis.rd = (globalThis.rd ?? 0) + 1;
console.log('R load db', globalThis.rd);
export let q = globalThis.rd;
export const up = () => { q += 100; };
