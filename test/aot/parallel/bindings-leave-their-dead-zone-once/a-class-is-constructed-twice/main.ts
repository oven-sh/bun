import { Box } from "./a";
const unseen = (0, eval)("(x) => x");
export function pair() { const first = new Box(1); unseen(first); return first.w + new Box(2).w; }
console.log(pair());
