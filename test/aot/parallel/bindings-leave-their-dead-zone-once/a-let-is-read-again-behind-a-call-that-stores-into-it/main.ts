import { count, bump } from "./a";
const unseen = (0, eval)("(f) => f()");
export function twice() { const first = count; unseen(bump); return first + ":" + count; }
console.log(twice(), twice());
