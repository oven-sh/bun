import { host } from "./host.js";
export const predicted = { a: host(), b: "x" };
let later: number | undefined = undefined;
export function store() { later = 5 }
store();
export const narrowed = { a: later ?? 0, b: "n" };
