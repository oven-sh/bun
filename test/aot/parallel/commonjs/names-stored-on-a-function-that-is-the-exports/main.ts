// `module.exports = f; module.exports.name = ..` in a JavaScript file: an import names what is stored on the function, the class or the literal.
import { used } from "./lib/fn.cjs";
import twice, { used as again, count } from "./lib/fn.cjs";
import { make } from "./lib/class.cjs";
import Thing from "./lib/class.cjs";
import { a, b } from "./lib/literal.cjs";
import { late } from "./lib/later.cjs";
import * as all from "./lib/fn.cjs";
import * as literal from "./lib/literal.cjs";
console.log(used(2), twice(2), again(3), count);
console.log(make() instanceof Thing, make().constructor.name);
console.log(a, b, late());
console.log(all.used(4), all.count, all.default(5), literal.a, literal.b);
