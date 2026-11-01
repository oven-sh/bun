// `__exportStar(require("./leaf.cjs"), exports)`, and another file reads two of the names in a loop: once the star is carried out its getters lie in the slots that the layout of the exports has for them, and a read looks nothing up.
// COUNT: arrivals <= 200
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const barrel_1 = require("./barrel.cjs");
function turn(i) { return (0, barrel_1.add)(i, barrel_1.two); }
let sum = 0;
for (let i = 0; i < 2000; i++) sum += turn(i & 7);
console.log(sum, barrel_1.own, barrel_1.late);
