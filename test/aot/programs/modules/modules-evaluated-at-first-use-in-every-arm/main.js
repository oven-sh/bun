// Modules without effects at their top level are evaluated at their first use. A function that uses one module in several arms, in loops, under try and in closures sees it evaluated before every use.
import { log } from "./log.js";
import * as first from "./first.js";
import * as second from "./second.js";
import * as third from "./third.js";
const arms = (way, n) => {
  let sum = 0;
  if (way === 0) sum += first.table.one;
  else if (way === 1) sum += second.table.two + first.table.one;
  else { for (let i = 0; i < n; i++) sum += third.table.three; sum += second.table.two; }
  sum += first.table.one;
  switch (n) { case 1: sum += second.table.two; break; case 2: sum += third.table.three; break; default: sum += first.add(1, 2); }
  return sum + third.table.three;
};
const underTry = flag => { let got; try { if (flag) throw new RangeError("thrown before the use"); got = second.table.two; } catch (error) { got = error.message + " " + second.table.two; } finally { got += ":" + third.table.three; } return got + ":" + second.table.two; };
const later = way => () => (way ? first.table.one : third.table.three) + second.table.two;
function* steps() { yield first.table.one; yield second.table.two; yield first.table.one + third.table.three; }
log.push("main runs");
for (const [way, n] of [[2, 2], [0, 0], [1, 1], [2, 0], [0, 2], [1, 3]]) log.push("arms " + way + " " + n + " = " + arms(way, n));
log.push(underTry(true), underTry(false));
log.push("closures " + later(0)() + " " + later(1)());
log.push("generator " + [...steps()].join());
let total = 0;
for (let i = 0; i < 20000; i++) total += arms(i % 3, i % 4);
log.push("many " + total);
console.log(log.join("\n"));
