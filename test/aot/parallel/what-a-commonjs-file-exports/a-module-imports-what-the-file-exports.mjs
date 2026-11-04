import Counter from "./lib-class.cjs";
import parse from "./lib-function.cjs";
import * as members from "./lib-members.cjs";
function use(i) { return new Counter().add(i).n + parse("ab") + members.twice(i); }
let sum = 0;
for (let i = 0; i < 300; i++) sum += use(i);
console.log(sum, Object.keys(members).sort().join());
