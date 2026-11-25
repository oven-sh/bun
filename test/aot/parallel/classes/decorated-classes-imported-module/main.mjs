import { Point, Extended, Late, replace } from "./library.cjs";
const make = i => new Point(i, 1), late = x => Object.keys(new Late(x)).join();
let sum = 0;
for (let i = 0; i < 50; i++) sum += make(i).sum();
console.log(sum, Object.keys(new Extended(1)).join(), late(1));
replace();
console.log(late(1));
