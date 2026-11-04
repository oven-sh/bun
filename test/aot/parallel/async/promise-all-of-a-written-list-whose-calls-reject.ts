// Promise.all of a list written in the call, whose listed calls of async functions reject at once, later, and both: the first rejection wins, no rejection goes unhandled, and the other bodies run to their ends.
const log: string[] = [];
process.on("unhandledRejection", reason => log.push("UNHANDLED " + String(reason)));
async function fine(x: number) {
  log.push("fine begins " + x);
  await null;
  await null;
  log.push("fine ends " + x);
  return x;
}
async function early(x: number): Promise<number> {
  log.push("early " + x);
  throw new Error("early " + x);
}
async function late(x: number): Promise<number> {
  log.push("late begins " + x);
  await null;
  throw new Error("late " + x);
}
function deed(which: number, x: number) {
  if (which === 0) return Promise.all([fine(x), late(x), fine(x + 1)]);
  if (which === 1) return Promise.all([fine(x), early(x), late(x)]);
  return Promise.all([late(x), late(x + 1), early(x + 2)]);
}
for (let which = 0; which < 3; which++) console.log(await deed(which, which * 10).then(list => list.join(), e => (e as Error).message));
await new Promise(resolve => setTimeout(resolve, 5));
console.log(log.join(" | "));
