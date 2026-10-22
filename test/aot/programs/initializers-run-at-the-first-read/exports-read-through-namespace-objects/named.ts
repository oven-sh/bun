export const TABLE = { a: 1, b: [1, 2] };
export const LIST = ["x", "y"].map(s => s + s);
export class Thing { static made = 0; n = ++Thing.made; }
export const SET = new Set(["p", "q"]);
export let counter = { n: 0 };
export function bump() { counter = { n: counter.n + 1 }; }
export const UNUSED = { big: [1, 2, 3, 4] };
