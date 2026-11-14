// Under: --aot-check=VerifyEachStage: every stage of the build is held against its rules
// Under: --aot-harden=proof-checks: what the walk has shown of the literal is asked of memory
// Under: --aot-testing=FailSpeculations: guesses fail unasked now and then: wherever the loop is left it goes on from that turn
const n = JSON.parse("1000");
const data = JSON.parse("[" + Array.from({ length: 64 }, (_, i) => (i * 37) % 100).join(",") + "]");
function job(d, turn) {
  const next = [turn & 3];
  let left = turn & 3;
  for (let j = 1; j <= 40; j++) {
    left = left + d[j];
    next[j] = left;
  }
  return next[40];
}
const jobs = { job };
const which = JSON.parse('"job"');
let sum = 0;
for (let turn = 0; turn < n; turn++) sum = (sum * 31 + jobs[which](data, turn)) % 1000003;
console.log("SAID", sum.toFixed(3));
