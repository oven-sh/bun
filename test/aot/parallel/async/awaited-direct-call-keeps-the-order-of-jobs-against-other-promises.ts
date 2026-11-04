// An awaited call of a known async function runs beside other promises: the log of who ran when is that of a call and an await.
const log: string[] = [];
async function load(x: number) {
  log.push("load begins " + x);
  await null;
  log.push("load goes on " + x);
  return x * 2;
}
async function run(x: number) {
  const v = await load(x);
  log.push("run has " + v);
  return v;
}
function deed(x: number) {
  const started = run(x);
  Promise.resolve().then(() => log.push("then 1")).then(() => log.push("then 2")).then(() => log.push("then 3")).then(() => log.push("then 4"));
  queueMicrotask(() => log.push("microtask"));
  return started;
}
console.log(String(await deed(1)));
console.log(log.join(" | "));
log.length = 0;
for (let i = 0; i < 3; i++) console.log(String(await deed(i)));
console.log(log.join(" | "));
log.length = 0;
const both = [deed(7), deed(8)];
console.log(String(await both[0]), String(await both[1]));
console.log(log.join(" | "));
