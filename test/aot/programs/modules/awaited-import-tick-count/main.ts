// `await import()` whose result is only read by name takes as many turns of the job queue as one whose result is used as a value.
const turns: string[] = [];
async function readsByName() {
  const { value } = await import("./effects");
  turns.push("by name " + value);
}
async function usesTheValue() {
  const module: Record<string, unknown> = await import("./effects");
  turns.push("as a value " + module["value"]);
}
for (const run of [readsByName, usesTheValue, readsByName]) {
  const waiting = run();
  let turn = Promise.resolve();
  for (let i = 1; i <= 6; i++) turn = turn.then(() => void turns.push("turn " + i));
  await waiting;
  await turn;
}
console.log(turns.join("\n"));
