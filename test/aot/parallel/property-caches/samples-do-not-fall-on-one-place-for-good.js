// One miss in 32 of all the places that remember nothing yet is a sample, and only a sampled place is filled. This loop makes 32 such misses a turn, and the last of them is a read that leaves nothing to remember
// (`length` of a Buffer is a getter of the engine). It begins right behind a sample, so with a period that never changes every sample falls on that one read, and the 31 reads that could be remembered never are.
// COUNT: operation:operationAOTFillSiteAnswers <= 3000
const countsSoFar = () => (typeof aotRuntimeCounters === "function" ? aotRuntimeCounters() : "");
function samplesSoFar() { for (const line of countsSoFar().split("\n")) { const [calls, name] = line.split("\toperation:"); if (name === "operationAOTFillSiteAnswers") return Number(calls); } return 0; }
const record = JSON.parse('{"a1":1,"a2":2,"a3":3,"a4":4,"a5":5,"a6":6,"a7":7,"a8":8,"a9":9,"a10":10,"a11":11,"a12":12,"a13":13,"a14":14,"a15":15,"a16":16,"a17":17,"a18":18,"a19":19,"a20":20,"a21":21,"a22":22,"a23":23,"a24":24,"a25":25,"a26":26,"a27":27,"a28":28,"a29":29,"a30":30,"a31":31}');
const bytes = [Buffer.from("abc"), { length: 3 }][Number(process.argv.length > 50)];
function lengthInFront(o) { return o.length; }
let sum = 0;
if (countsSoFar()) { const before = samplesSoFar(); for (let i = 0; i < 100 && samplesSoFar() === before; i++) sum -= lengthInFront(bytes) - 3; }
for (let turn = 0; turn < 20000; turn++) {
  sum += record.a1 + record.a2 + record.a3 + record.a4 + record.a5 + record.a6 + record.a7 + record.a8 + record.a9 + record.a10 + record.a11 + record.a12 + record.a13 + record.a14 + record.a15 + record.a16 + record.a17 + record.a18 + record.a19 + record.a20 + record.a21 + record.a22 + record.a23 + record.a24 + record.a25 + record.a26 + record.a27 + record.a28 + record.a29 + record.a30 + record.a31;
  sum += bytes.length;
}
console.log(sum);
