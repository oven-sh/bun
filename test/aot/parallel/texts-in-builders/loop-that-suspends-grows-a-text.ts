// the text grows in a loop that suspends: at an await, at a yield, and in a coroutine whose loop does not suspend
async function awaited(n: number) { let s = ""; for (let i = 0; i < n; i++) { s += "k" + i; if (i % 2) await null; } return s; }
function* yielded(n: number) { let s = ""; for (let i = 0; i < n; i++) { s += "k" + i; yield s; } return s + "!"; }
async function besideAnAwait(n: number) { await null; let s = ""; for (let i = 0; i < n; i++) s += "k" + i; await null; return s; }
function drain(n: number) { const steps = yielded(n); let out = ""; for (let step = steps.next(); ; step = steps.next()) { out = out + step.value + (step.done ? "." : "|"); if (step.done) return out; } }
async function main() {
  console.log(drain(0), drain(1), drain(4));
  const both = yielded(3);
  const other = yielded(3);
  console.log(both.next().value, other.next().value, both.next().value, both.next().value, other.next().value, both.next().value);
  console.log(await awaited(0) === "", await awaited(1), await awaited(5));
  console.log((await Promise.all([awaited(4), awaited(3), besideAnAwait(4)])).join(" "));
  console.log(await besideAnAwait(0) === "", await besideAnAwait(6));
}
main();
