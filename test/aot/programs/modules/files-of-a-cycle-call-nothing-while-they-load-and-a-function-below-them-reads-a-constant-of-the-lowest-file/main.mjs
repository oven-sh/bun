import { viaThird } from "./first.mjs";
let sum = 0;
for (let turn = 0; turn < 12; turn++) sum += viaThird(turn);
console.log(sum);
