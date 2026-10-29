// The same as awaited-import-typed-reads, in JavaScript: no checker says what `await import()` answers. The flow analysis follows the namespace object through the promise,
// and the type of a value that is the namespace object of an ES module is the layout of that namespace object, so what is read from it by name is the variable that the module exports.
// IR= 0 member PropGet|ElemGet| = Call v|CallMethod
// IR= 0 pattern PropGet|ElemGet| = Call v|CallMethod
// IR= 0 held PropGet|ElemGet| = Call v|CallMethod
// IR= 0 heldAndChained PropGet|ElemGet| = Call v|CallMethod
// IR= 0 constructs PropGet|ElemGet
// IR= 1 asAValue ElemGet
import { log } from "./log.js";

async function member() {
  return (await import("./lib.js")).constant + (await import("./lib.js")).twice(4) + (await import("./lib.js")).counter + (await import("./lib.js")).default;
}
async function pattern() {
  const { constant, twice, counter: seen = -1, arrow, default: byDefault } = await import("./lib.js");
  return constant + twice(5) + seen + arrow(2) + byDefault;
}
async function held() {
  const lib = await import("./lib.js");
  return lib.constant + lib.twice(6) + lib.counter + lib.arrow(3) + lib.default;
}
async function heldAndChained() {
  const lib = await import("./lib.js");
  return lib?.twice(7) + lib.constant + lib.counter;
}
async function constructs() {
  const { Box } = await import("./lib.js");
  const lib = await import("./lib.js");
  return new Box(1).value + new lib.Box(2).value + Number(new Box(3) instanceof lib.Box);
}
async function asAValue(key) {
  const lib = await import("./lib.js");
  return lib[key];
}

log("main begins");
for (const run of [member, pattern, held, heldAndChained, constructs]) log(run.name, await run());
(await import("./lib.js")).increment();
for (const run of [member, pattern, held, heldAndChained]) log(run.name, await run());
log(await asAValue("constant"), await asAValue("counter"), await asAValue("absent"));
