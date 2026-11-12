// A resource that the body of a loop declares is disposed where the iteration awaits in an `if`.
const log = [];
const resources = [0, 1, 2, 3, 4, 5].map(n => ({ [Symbol.dispose]() { log.push("disposed " + n); } }));
let count = 0;
async function byFor(limit) {
  for (let i = 0; i < limit; i++) {
    using resource = resources[i];
    if (i % 2) { await null; log.push("awaited " + i); }
    count++;
  }
}
async function byWhile(limit) {
  let i = -1;
  while (++i < limit) {
    using resource = resources[i];
    if (i % 2) { await null; log.push("awaited " + i); } else log.push("other " + i);
    count++;
  }
}
async function continues(limit) {
  for (let i = 0; i < limit; i++) {
    if (i === 5) continue;
    using resource = resources[i];
    if (i === 0) continue;
    if (i % 2) { await null; if (i === 3) continue; log.push("awaited " + i); }
    if (i === 2) continue;
    count++;
  }
}
async function leaves(limit) {
  for (let i = 0; i < limit; i++) {
    using resource = resources[i], second = resources[i + 1];
    if (i % 2) { await null; if (i === 3) break; log.push("awaited " + i); }
    count++;
  }
  return count;
}
async function throws(limit) {
  for (let i = 0; i < limit; i++) {
    using resource = resources[i];
    if (i % 2) { await null; if (i === 3) throw new Error("thrown"); }
    count++;
  }
}
for (const run of [byFor, byWhile, continues, leaves, throws]) {
  log.length = 0;
  try { await run(6 - (run === leaves)); } catch (error) { log.push(error.message); }
  console.log(run.name, count, log.join(", "));
}
