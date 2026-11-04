import { count, bump } from "./a";
const unseen = (0, eval)("(f) => f()");
export function sum(turns: number) { let all = ""; for (let i = 0; i < turns; i++) { all += count + ","; unseen(bump); } return all + count; }
console.log(sum(0), sum(3));
