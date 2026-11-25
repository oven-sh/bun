import { drainMicrotasks } from "bun:jsc";
const out: string[] = [];
const names = (error: Error) => String(error.stack).split("\n").slice(1).map(l => l.trim().replace(/\(.*\/(.*)\)/, "($1)")).join(" | ");
async function inner(n: number) {
  await n;
  Promise.resolve().then(() => out.push("job " + n));
  out.push("before " + names(new Error("x")));
  drainMicrotasks();
  out.push("after " + names(new Error("x")));
  await n;
  out.push("behind " + names(new Error("x")));
  return n;
}
async function outer(n: number) {
  const a = await inner(n);
  out.push("outer " + names(new Error("y")));
  const b = await inner(n + 1);
  out.push("outer " + (a + b));
  return a + b;
}
async function main() {
  await 1;
  for (let i = 0; i < 2; i++) out.push("sum " + (await outer(i)));
}
await main();
for (let i = 0; i < 2; i++) out.push("top " + (await outer(i)));
console.log(out.join("\n"));
