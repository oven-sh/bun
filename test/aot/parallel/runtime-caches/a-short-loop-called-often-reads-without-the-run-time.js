// A loop reads eight names off one object. Once a long run has filled its sites, short runs of the same loop do not come to the run time.
// Flags: --aot-heat=none
// Env: JSC_aotCountsPath=/dev/null
const counts = typeof aotOperationCount === "function";   // Only the jsc shell can count. Elsewhere the program checks the answers alone.
function entries() { let sum = 0; if (counts) for (const name of ["GetByIdAndCache", "FillSiteCache"]) sum += aotOperationCount("operationAOT" + name); return sum; }

const names = JSON.parse('["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"]');
const [longRun, shortRun, calls] = JSON.parse("[1000, 3, 200]");

function record() {
  const o = Object.create(null);
  for (let i = 0; i < names.length; i++) o[names[i]] = i + 1;
  return o;
}
function total(o, n) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    s += o.first; s += o.second; s += o.third; s += o.fourth;
    s += o.fifth; s += o.sixth; s += o.seventh; s += o.eighth;
  }
  return s;
}

const o = record();
console.log("long run: " + total(o, longRun));
const before = entries();
let sum = 0;
for (let call = 0; call < calls; call++) sum += total(o, shortRun);
const after = entries();
if (after !== before) throw new Error("short runs came to the run time " + (after - before) + " times");
console.log("short runs: " + sum);
