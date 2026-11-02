import { tools } from "kit";
import add = tools.add;
import twice = tools.twice;
console.log(add(1), twice(2), typeof add, add === tools.add, [1, 2].map(twice).join());
function later() { return add(10) + twice(10); }
console.log(later());
