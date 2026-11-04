// An awaited direct call rejects, in front of its first await and behind it, under try, catch and finally of the caller.
const log: string[] = [];
async function fail(when: string, x: number) {
  if (when === "early") throw new RangeError("early " + x);
  await null;
  if (when === "late") throw new TypeError("late " + x);
  return x;
}
async function run(when: string, x: number) {
  let stored = "nothing";
  try {
    stored = "before";
    const v = await fail(when, x);
    stored = "after " + v;
    return stored;
  } catch (e) {
    return (e as Error).name + ": " + (e as Error).message + ", stored " + stored;
  } finally {
    log.push("finally " + when + " " + stored);
  }
}
function deed(when: string, x: number) {
  return run(when, x);
}
console.log(await deed("early", 1));
console.log(await deed("late", 2));
console.log(await deed("never", 3));
for (let i = 0; i < 4; i++) console.log(await deed(i % 2 ? "early" : "late", i));
console.log(log.join(" | "));
