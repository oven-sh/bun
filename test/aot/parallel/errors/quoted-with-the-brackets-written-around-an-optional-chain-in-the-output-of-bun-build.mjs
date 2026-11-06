// @bun
// `bun <file>` runs a file with this mark as it is written, so an error quotes the round brackets around an optional chain where they are written: also those that
// a transpiler would not print, behind which the chain goes on.
const o = { one: 1, a: {}, none: null };
function tell(label, run) {
  try {
    run(o);
    console.log(label + ": nothing thrown");
  } catch (error) {
    console.log(label + ": " + error.message);
  }
}
tell("chain called", o => (o?.one)(1));
tell("member called", o => (o?.a).m1(2));
tell("member read", o => (o?.none).x2);
tell("chain that goes on behind brackets called", o => (o?.a)?.m3(3));
tell("chain that goes on called", o => o?.a.m4(4));
