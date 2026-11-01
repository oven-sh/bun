// Entry points: ./library.ts
// Alone: the text finds its second entry point by the path beside the first
import { table, twice } from "./library";
async function evaluate(source: string) {
  try {
    console.log(String(await (0, eval)(process.argv.length > 99 ? "1" : source)));
  } catch (error) {
    console.log("threw " + (error as { code?: string }).code);
  }
}
console.log(twice(2), table.grow(1));
const path = JSON.stringify(import.meta.resolve("./library"));
await evaluate(`import(${path}).then(m => m.twice("ab"))`);
await evaluate(`import(${path}).then(m => m.twice({ valueOf() { return 4; } }))`);
await evaluate(`import(${path}).then(m => m.table.grow("x"))`);
await evaluate(`import(${path}).then(m => Object.keys(m).join())`);
console.log(table.size, twice(5));
