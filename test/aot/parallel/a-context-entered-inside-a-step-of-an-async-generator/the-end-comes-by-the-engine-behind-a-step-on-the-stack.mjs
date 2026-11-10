// The consumer of a step is an async generator that has passed an await on the stack, and the end of the inner generator comes to it by the engine: the flag of the passed await
// may not be left in the frame's byte there, where it would be handed on as the status of the step.
const later = () => new Promise((resolve) => setTimeout(resolve, 2));
async function* inner() { yield 1; await later(); }
async function* sums() { let total = 0; for await (const v of inner()) total += v; yield total; }
async function* hands() { for await (const v of inner()) { yield v * 10; await null; } yield "behind"; }
async function main() { await later(); const seen = []; let turns = 0;
  for await (const v of sums()) seen.push(String(v));
  for await (const v of hands()) { seen.push(String(v)); if (++turns > 5) break; }
  console.log(seen.join(" ")); }
main();
