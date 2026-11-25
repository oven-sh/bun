import { table, swap } from "./exporter-of-a-binding.mjs";
const unseen = (x) => ({ a: x })[JSON.parse('"a"')];
const say = (...all) => console.log(all.join(" "));
function sum(turns) { let s = 0; for (let i = 0; i < turns; i++) s += table[i]; return s; }
function sumAndSwap(turns) { let s = 0; for (let i = 0; i < turns; i++) { s += table[i]; if (i === 1) swap(); } return s; }
say(unseen(sum)(4)); say(unseen(sumAndSwap)(4)); say(unseen(sum)(4));
