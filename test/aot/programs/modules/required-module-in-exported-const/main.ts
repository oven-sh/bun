// A constant that holds a required module holds nothing in the compiled program: whoever comes by it from another file, through the namespace of its module, a class, a table, a spread or CommonJS gets the one namespace object.
import byDefault, { held, loose, renamed, give, Keeps, table } from "./a";
import * as a from "./a";
import fromCjs from "./b.cjs";
held.bump();
console.log(held.constant, loose.constant, renamed.counter, byDefault.counter, held.twice(2), loose.twice(3));
console.log(a.held === a.loose, a.held === held, give() === renamed, Keeps.lib === held, new Keeps().own === loose, table.lib === table.list[0]);
console.log(Object.keys(a).join(), Object.keys(a.held).join(), typeof a.held, JSON.stringify(a.renamed));
const { held: again } = a;
const copy = { ...a };
console.log(again.counter, copy.held.counter, copy.loose === held, fromCjs);
for (const key in a) if (key === "held") console.log(key, (a as any)[key].constant);
