import { TABLE, sum } from "./holder-of-a-table.mjs";
const unseen = (x) => ({ a: x })[JSON.parse('"a"')];
console.log(unseen(sum)()); TABLE[0] = 1000; console.log(unseen(sum)()); unseen(TABLE).length = 2; console.log(unseen(sum)());
