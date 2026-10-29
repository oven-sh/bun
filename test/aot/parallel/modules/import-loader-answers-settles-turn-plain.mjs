// Each line: how many turns of the job queue an import() takes that names a text, or a module under a name made at run time, and how it settles.
let turns = 0;
let isDone = false;
const count = () => {
  if (isDone) return;
  turns++;
  Promise.resolve().then(count);
};
async function measure(label, load) {
  turns = 0;
  isDone = false;
  count();
  let how = "fulfilled";
  try {
    await load();
  } catch (error) {
    how = "rejected " + error.name;
  }
  isDone = true;
  console.log(label + ":", turns, how);
  await 0;
  await 0;
}
const made = text => text.split("").join("");

await measure("a text", () => import("data:text/javascript,export default 1"));
await measure("the same text", () => import("data:text/javascript,export default 1"));
await measure("a text that throws", () => import("data:text/javascript,throw new RangeError('x')"));
await measure("the same text", () => import("data:text/javascript,throw new RangeError('x')"));
await measure("a text that does not parse", () => import("data:text/javascript,export default ("));
await measure("a text that awaits", () => import("data:text/javascript,await 0; await 0; export default 1"));
await measure("a text that imports a built-in module", () => import("data:text/javascript,import p from 'node:path'; export default p"));
await measure("a text that imports a text", () => import("data:text/javascript,import a from 'data:text/javascript,export default 3'; export default a"));
await measure("the inner text", () => import("data:text/javascript,export default 3"));
await measure("bun under a made name", () => import(made("bun")));
await measure("the same name", () => import(made("bun")));

const order = [];
const loads = [
  import("data:text/javascript,export default 4").then(() => order.push("text")),
  import("node:os").then(() => order.push("built-in")),
  import(made("bun")).then(() => order.push("bun")),
];
let chain = Promise.resolve();
for (let step = 0; step < 24; step++) chain = chain.then(() => order.push(step));
await Promise.all([...loads, chain]);
console.log(order.join(" "));

process.on("unhandledRejection", (error, promise) => console.log("unhandled:", error.name, promise === kept));
const kept = import("data:text/javascript,throw new TypeError('y')");
await new Promise(resolve => setTimeout(resolve, 20));
kept.catch(error => console.log("caught late:", error.name));
await new Promise(resolve => setTimeout(resolve, 20));
