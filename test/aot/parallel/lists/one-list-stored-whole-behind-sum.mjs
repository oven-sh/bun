// One list under two names: converted to doubles under the one, stored int32s into under the other.
const table0 = new Array(4).fill(2);
const say = list => Array.from(list, x => Object.is(x, -0) ? "-0" : String(x)).join();
function compute2(a, given) {
  let v9 = a | 0, v10 = a | 0, i11 = 2, seen = 0;
  given[v10 & 3] = (v9 << v10);
  let i13 = 0;
  for (;;) {
    if (i13++ > 1) break;
    let i15 = 2;
    while (i15-- > 0) {
      given[1] = table0[1] + a;
      table0[1] = i13;
      seen += typeof given[1] === "number" ? given[1] : 100;
    }
  }
  return seen;
}
console.log("SAID", compute2(0.5, table0), say(table0)); console.log("SAID", compute2(3, table0), say(table0));
const other = [1, 1.5, 1, 1]; console.log("SAID", compute2(0.5, other), say(other), say(table0)); console.log("SAID", compute2(-2.5, table0), say(table0)); console.log("SAID", compute2(7, [4, 4, 4, 4]), say(table0));
