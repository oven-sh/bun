// a-copy-of-a-bun-that-nobody-named-has-no-build.js, where the variable first holds a value nobody knows. The answer is the same.
// Alone: what it prints depends on what else the executable holds: which modules and members were compiled in, and whether anything evaluates text
import { deserialize, serialize } from "node:v8";
import { join } from "node:path";

const values = Object.values(globalThis);
const index = Object.keys(globalThis).indexOf(["B", "un"].join(process.argv.length > 99 ? "x" : ""));

let source = deserialize(serialize({ note: "a value nobody knows" }));
const holder0 = { next: () => values[index] };
const holder1 = { next: () => holder0.next() };
const holder2 = { next: () => holder1.next() };
const holder3 = { next: () => holder2.next() };
const holder4 = { next: () => holder3.next() };
const holder5 = { next: () => holder4.next() };
const holder6 = { next: () => holder5.next() };
const holder7 = { next: () => holder6.next() };
if (index >= 0) source = holder7.next();

const x = { build() { return { success: "own", outputs: [] }; }, ...source };
const seen = [];
try {
  const result = await x.build({
    entrypoints: [join(process.cwd(), "entry.js")],
    plugins: [{ name: "watch", setup(build) { build.onLoad({ filter: /entry\.js$/ }, args => { seen.push("loaded"); return undefined; }); } }],
  });
  console.log(result.success, result.outputs.length, seen.join());
  if (result.outputs.length) console.log((await result.outputs[0].text()).includes("bundled"));
} catch (error) {
  console.log(error.name + ": " + error.message.split(" because")[0]);
}
/* Output:
Error: None of Bun.build, Bun.plugin or Bun.serve was compiled into this executable
*/
