// A closure keeps the variables that it names alive. Under `bun <file>` it keeps every captured variable of its scope alive, here `r`, which only the other closure names.
// Prints what the compiler saves: objects that are collected earlier
// Alone: what is let go of goes by which bodies are copied into which, and that by all that the executable holds
let collected = 0;
const registry = new FinalizationRegistry(() => {
  collected++;
});
function make(r) {
  const n = r.n;
  const both = [() => r, () => n];
  return both[1];
}
const kept = [];
for (let i = 0; i < 500; i++) {
  const r = { n: i };
  registry.register(r, i);
  kept.push(make(r));
}
for (let i = 0; i < 5; i++) {
  Bun.gc(true);
  await new Promise(resolve => setTimeout(resolve, 5));
}
// A registry that is read no more may be collected, and then it calls nothing.
registry.unregister(kept);
let sum = 0;
for (const read of kept) sum += read();
// The stack may still hold a few.
console.log(collected > 400, sum);
/* Output:
true 124750
*/
