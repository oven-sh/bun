// A CommonJS module requires ES modules: members, patterns and constants that hold a module read what the module declares; a `var` that holds one is `undefined` until it is stored to; sloppy code stores to a module in vain.
// IR= 0 held PropGet|ElemGet|(Prop|Elem)Define| = Call v|CallMethod
// IR= 0 pattern PropGet|ElemGet|(Prop|Elem)Define| = Call v|CallMethod
// IR= 0 memberOfTheCall PropGet|ElemGet|(Prop|Elem)Define| = Call v|CallMethod
const attempt = run => {
  try {
    return run();
  } catch (error) {
    return error.constructor.name;
  }
};
console.log(attempt(() => hoisted.constant), typeof hoisted, attempt(() => lib.constant));
console.log("before");
const lib = require("./lib.mjs");
console.log("after");
var hoisted = require("./lib.mjs");
function held() {
  return lib.constant + lib.twice(2) + lib.counter;
}
function pattern() {
  const { constant, twice, counter } = require("./lib.mjs");
  return constant + twice(3) + counter;
}
function memberOfTheCall() {
  return require("./lib.mjs").constant + require("./lib.mjs").twice(4) + require("./lib.mjs").counter;
}
console.log(held(), pattern(), memberOfTheCall(), hoisted.constant, hoisted === lib);
lib.increment();
console.log(held(), pattern(), memberOfTheCall(), hoisted.counter);
lib.constant = 5;
lib.added = 6;
console.log(lib.constant, lib.added, delete lib.constant, delete lib.absent, lib.__esModule, Object.keys(lib).join());
console.log(lib.self() === lib, typeof lib.sloppy, require("./lib.mjs").self() === lib);
exports.done = true;
