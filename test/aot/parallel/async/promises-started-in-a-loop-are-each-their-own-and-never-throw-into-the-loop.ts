// A loop starts a known async function in each turn and keeps the promises: each is its own object, a subclass sees them as promises, and a body that throws at once rejects its promise and leaves the loop alone.
const log: string[] = [];
async function work(x: number) {
  log.push("begins " + x);
  if (x === 1) throw new Error("at once " + x);
  await null;
  if (x === 2) throw new Error("later " + x);
  return x * 10;
}
function deed(n: number) {
  const started: Promise<number>[] = [];
  for (let i = 0; i < n; i++) started.push(work(i));
  log.push("loop is over");
  return started;
}
const started = deed(4);
console.log(String(started[0] === started[1]), String(started[0] instanceof Promise), Object.prototype.toString.call(started[3]));
console.log(String(Object.getPrototypeOf(started[2]) === Promise.prototype), String(started[1].constructor === Promise));
for (const settled of await Promise.allSettled(started)) console.log(settled.status, settled.status === "fulfilled" ? String(settled.value) : (settled.reason as Error).message);
console.log(log.join(" | "));
console.log(String(deed(0).length));
