import { show } from "./show.js";

console.log("this file is strict:", (function () {
  return this === undefined;
})());

async function sizeOfValue(name) {
  const loaded = await import("./modules/" + name);
  return loaded.value.length;
}
async function kind(name) {
  return typeof (await import("./modules/" + name));
}
let sum = 0;
for (let i = 0; i < 200; i++) sum += await sizeOfValue("plain.js");
console.log("sum", sum);
for (const name of ["plain.js", "with-then.js", "then-rejects.js", "then-throws.js", "then-is-a-number.js", "then-resolves-with-a-thenable.js", "commonjs-then.cjs", "plain.js"]) {
  for (const [label, use] of Object.entries({ sizeOfValue, kind })) {
    try {
      console.log(label + "(" + name + ")", show(await use(name)));
    } catch (error) {
      console.log(label + "(" + name + ")", "threw", error.constructor.name);
    }
  }
}
