// `next` is stored on an async generator itself, between two awaited steps that are written by hand: its own `next` answers with a plain object, a thenable and a promise, and the order of jobs beside another promise is that of a call and an await.
const log: string[] = [];
async function* ticks(n: number) {
  for (let i = 0; i < n; i++) yield i;
}
const show = (r: any) => String(r.value) + ":" + String(r.done);
const answers = [
  () => ({ value: "plain", done: false }),
  () => ({ then(resolve: (v: unknown) => void) { log.push("then is called"); resolve({ value: "thenable", done: false }); } }),
  () => Promise.resolve({ value: "promise", done: true }),
];
async function deed(which: number) {
  const it = ticks(3);
  const a = await it.next();
  if (which >= 0) (it as any).next = answers[which];
  Promise.resolve().then(() => log.push("then 1")).then(() => log.push("then 2")).then(() => log.push("then 3"));
  const b = await it.next();
  log.push("has " + show(b));
  return show(a) + " " + show(b);
}
console.log(await deed(-1));
for (let i = 0; i < 3; i++) console.log(await deed(i));
console.log(await deed(-1));
await null;
await null;
console.log(log.join(" | "));
