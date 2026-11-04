// One await under try and finally takes a choice among a value, a call that rejects at once and a call that rejects later: the handler round the await gets each rejection, with what was stored before.
const log: string[] = [];
async function early(x: number): Promise<number> {
  throw new Error("early " + x);
}
async function late(x: number): Promise<number> {
  await null;
  throw new Error("late " + x);
}
async function run(which: number, x: number) {
  let stored = "nothing";
  try {
    stored = "chosen " + which;
    const v = await (which === 0 ? x : which === 1 ? early(x) : late(x));
    stored = "given " + v;
    return stored;
  } catch (e) {
    return (e as Error).message + " with " + stored;
  } finally {
    log.push("finally " + stored);
  }
}
function deed(which: number, x: number) {
  return run(which, x);
}
console.log(await deed(0, 1));
console.log(await deed(1, 2));
console.log(await deed(2, 3));
for (let i = 0; i < 6; i++) console.log(await deed(i % 3, i));
console.log(log.join(" | "));
