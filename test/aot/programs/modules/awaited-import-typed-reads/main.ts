// What is read by name from `await import()` of an ES module is what the module declares, as with an import statement: a member, a pattern and a constant that holds the module look nothing up by name, and functions are called directly. The promise and the wait stay.
// IR= 0 member GetById|GetByVal| = Call v|CallMethod
// IR= 0 pattern GetById|GetByVal| = Call v|CallMethod
// IR= 0 held GetById|GetByVal| = Call v|CallMethod
// IR= 0 heldAndChained GetById|GetByVal| = Call v|CallMethod
// IR= 0 constructs GetById|GetByVal
// IR= 1 asAValue GetByVal
import { log } from "./log";

async function member() {
  return (await import("./lib")).constant + (await import("./lib")).twice(4) + (await import("./lib")).counter + (await import("./lib")).default;
}
async function pattern() {
  const { constant, twice, counter: seen = -1, arrow, default: byDefault } = await import("./lib");
  return constant + twice(5) + seen + arrow(2) + byDefault;
}
async function held() {
  const lib = await import("./lib");
  return lib.constant + lib.twice(6) + lib.counter + lib.arrow(3) + lib.default;
}
async function heldAndChained() {
  const lib = await import("./lib");
  return lib?.twice(7) + lib!.constant + lib.counter;
}
async function constructs() {
  const { Box } = await import("./lib");
  const lib = await import("./lib");
  return new Box(1).value + new lib.Box(2).value + Number(new Box(3) instanceof lib.Box);
}
async function asAValue(key: string) {
  const lib: Record<string, unknown> = await import("./lib");
  return lib[key];
}

log("main begins");
for (const run of [member, pattern, held, heldAndChained, constructs]) log(run.name, await run());
(await import("./lib")).increment();
for (const run of [member, pattern, held, heldAndChained]) log(run.name, await run());
log(await asAValue("constant"), await asAValue("counter"), await asAValue("absent"));
