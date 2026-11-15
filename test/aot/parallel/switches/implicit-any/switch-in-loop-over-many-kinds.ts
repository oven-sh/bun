// Under: --aot-check=Validate: the build stopped with UseNotDominated in every mode, so the verifier must accept this loop too
// Under: --aot-harden=proof-checks,ignore-told-ranges: the build stopped with UseNotDominated in every mode
// Runs every version of the loop: plain arrays, arrays that fail the pristine check, typed arrays, a Buffer, an object, a string and primitives. The build stopped.
function count(list, from, to) {
  let zeros = 0, i = from;
  while (i < to) {
    switch (list[i]) { case 0: zeros++; }
    i += 1;
  }
  return zeros + "/" + i;
}
class Samples extends Array {}
const start = process.argv.length - 2;
const plain = JSON.parse("[0,4,0,6,0]");
const named = JSON.parse("[0,0,0,1,0]");
named.label = "named";
const derived = Samples.from([0, 1, 0, 1, 0]);
const sparse = [0, , 0, , 0];
const reparented = Object.setPrototypeOf([0, 0, 1, 1, 0], { 7: 0 });
const bytes = new Uint8Array([0, 0, 0, 0, 9]);
const buffer = Buffer.from([1, 0, 1, 0, 1]);
const words = new Uint16Array([0, 300, 0, 300, 0]);
const record = { 0: 0, 1: "0", 2: 0, 3: null, 4: -0 };
for (const list of [plain, named, derived, sparse, reparented, bytes, buffer, words, record, "00000", 5, true])
  console.log(count(list, start, 5), count(list, start + 1, 8));
