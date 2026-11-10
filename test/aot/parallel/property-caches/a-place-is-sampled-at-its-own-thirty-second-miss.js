// A place of answers counts its own misses. Its 32nd miss is its first sample, and that sample fills it, however many misses other places make in between.
// Counted together with everybody's, which miss of a place was a sample hung on all the code that ran before it.
// Env: JSC_aotCountsPath=/dev/null
const countsSoFar = () => (typeof aotRuntimeCounters === "function" ? aotRuntimeCounters() : "");
function samplesSoFar() { for (const line of countsSoFar().split("\n")) { const [calls, name] = line.split("\toperation:"); if (name === "operationAOTFillSiteAnswers") return Number(calls); } return 0; }
const shapes = [];
for (let i = 0; i < 24; i++) shapes.push(JSON.parse('{"s' + i + '":1,"worth":' + i + "}"));
function readHere(o) { return o.worth; }
function readElsewhere(o) { return o.worth; }
let sum = 0;
const wrong = [];
for (let miss = 1; miss <= 40; miss++) {
  for (let i = 0; i < (miss * 5) % 7; i++) sum += readElsewhere(shapes[(miss + i) % 24]);
  const before = samplesSoFar();
  sum += readHere(shapes[0]);
  const samples = samplesSoFar() - before;
  if (countsSoFar() && samples !== (miss === 32 ? 1 : 0)) wrong.push(miss + ": " + samples);
}
console.log(sum);
// Only the jsc shell can count. Only what is wrong is said: the shell must print what plain Bun prints.
if (wrong.length) console.log("samples at the misses of one place: " + wrong.join(", "));
