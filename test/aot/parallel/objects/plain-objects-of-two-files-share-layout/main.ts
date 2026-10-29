// Two files make plain objects with the same names. They share one layout, and each file knows `run` by the function type that it writes itself: what either stores is read and called through the other's type.
import { one } from "./one";
import { two } from "./two";

const first = one({ skipped: 0, run: () => 1, size: 10 });
const second = two({ skipped: 0, run: () => 2, size: 20 });
let either = first;
console.log(either.run(), either.size);
either = second;
console.log(either.run(), either.size);
for (const rest of [first, second, first]) console.log(rest.run() + rest.size, Object.keys(rest).join(), JSON.stringify(rest));
second.run = first.run;
console.log(second.run(), "skipped" in second);
