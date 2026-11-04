// Promise.all of a list written in the call, of direct calls, a thenable, a promise and a value, beside other promises: the log of who ran when is that of the built-in on a list.
const log: string[] = [];
async function quick(x: number) {
  log.push("quick begins " + x);
  await null;
  log.push("quick ends " + x);
  return x;
}
async function slow(x: number) {
  log.push("slow begins " + x);
  await null;
  await null;
  await null;
  log.push("slow ends " + x);
  return x;
}
const thenable = {
  then(resolve: (v: string) => void) {
    log.push("then is called");
    resolve("thenable");
  },
};
async function deed(x: number) {
  const settled = Promise.resolve("settled");
  const started = Promise.all([quick(x), slow(x), thenable, settled, x]);
  Promise.resolve().then(() => log.push("then 1")).then(() => log.push("then 2")).then(() => log.push("then 3")).then(() => log.push("then 4")).then(() => log.push("then 5"));
  const list = await started;
  log.push("all has " + list.join());
  return list.length;
}
console.log(String(await deed(1)));
console.log(log.join(" | "));
log.length = 0;
for (let i = 0; i < 2; i++) console.log(String(await deed(i)));
console.log(log.join(" | "));
