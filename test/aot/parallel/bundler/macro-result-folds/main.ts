import { pair } from "./macro" with { type: "macro" };
const one = pair(1 + 2, "a" + "b");
console.log(JSON.stringify(one), pair(1, "x") === pair(1, "x"));
