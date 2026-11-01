// Only through the namespace object of a module that exports them again does this program call the functions, change the object and construct the class that a
// CommonJS file behind two `export *` exports.
import { use } from "./reader.cjs";
import * as all from "./second.mjs";

const hold = [all][0];
console.log(hold.count(), (0, hold.count)(), all.count());
hold.box.n = 41;
hold.box.list.push(3);
hold.box.extra = "x";
console.log(hold.read(), new hold.Point(4).twice(), hold.Point.name, JSON.stringify(hold.box));
for (const key in hold) console.log(key, typeof hold[key]);
console.log(use());
console.log(all.c, all.bump(), all.c, hold.c);
