// Evaluated text finds no data file of the executable.
// Reference: bun build --compile
// Alone: another program of the executable may load files by a dynamic name, and then the text finds the file
import data from "./data.json";
async function evaluate(source: string) {
  try {
    console.log(String(await (0, eval)(process.argv.length > 99 ? "1" : source)));
  } catch (error) {
    console.log("threw " + (error as { code?: string }).code);
  }
}
function sum() {
  let total: unknown = 0;
  for (const each of data.list) total = (total as number) + each;
  return total;
}
console.log(sum(), data.name);
const path = JSON.stringify(import.meta.resolve("./data.json"));
await evaluate(`import(${path}).then(m => { m.default.list[0] = "changed"; m.default.name = 7; m.default.extra = 1; return Object.keys(m.default).join(); })`);
console.log(sum(), data.name, Object.keys(data).join());
