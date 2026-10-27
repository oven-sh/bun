// A .ts file without import or export is a script unless the project says `moduleDetection: force`. Its interfaces add to the global ones of the same name, as for tsc and `bun check`.
import "./additions";

const numbers: number[] = [1, 2, 3];
const last: number | undefined = numbers.lastOne();
console.log(last, ["a", "b"].lastOne(), "importer".shout(), numbers.length, "abc".length);
