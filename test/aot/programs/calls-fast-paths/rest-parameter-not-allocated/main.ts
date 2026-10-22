// Rest parameters and `arguments` are not allocated where they are only read, in untyped functions that are called as values.
// IR= 0 lengthOnly CreateRest
// IR= 1 lengthOnly GetRestLength(?! firstArgument=)
// IR= 0 firstOnly CreateRest
// IR= 0 sum CreateRest
// IR= 1 sum GetMyArgumentByVal
// IR= 0 viaArguments CreateRest
// IR= 0 viaArguments Create\w+Arguments
// IR= 0 copies CreateRest
// IR= 1 copies GetMyArgumentByVal
// inHandler has one caller, is copied into it and is gone: what is left of it stands in run.
// IR= 0 run CreateRest
// IR+ "dispatch" \w+ role=GenericEntrypoint
// IR- "dispatch" \w+ role=GenericEntrypoint .* arguments=Registers
// @ts-ignore
import untyped from "./untyped.js";
declare const console: any;
const m: any = untyped;
function run(count: number): number {
  let s = 0;
  const thrower = () => { throw 1; };
  for (let i = 0; i < count; i++) {
    s += m.lengthOnly(i, i) + m.firstOnly(1, 2, 3) + m.sum(1, 2, 3) + m.dispatch("x", 1) + m.dispatch("x", 1, 2) + m.viaArguments(1, 2) + m.copies(1, 2, 3);
    if ((i & 1023) === 0) s += m.inHandler(thrower, 5, 6) + m.dispatch("x", 1, 2, 3) + m.dispatch("x");
  }
  return s;
}
console.log(run(1_000_000));
export {};
