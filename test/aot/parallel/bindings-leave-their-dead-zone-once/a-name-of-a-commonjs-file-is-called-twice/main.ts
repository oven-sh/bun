import { twice, thrice } from "./c.cjs";
const unseen = (0, eval)("(x) => x");
export function both(x: number) { const first = twice(x); unseen(first); return first + twice(x + 1) + thrice(x); }
console.log(both(1), both(2));
