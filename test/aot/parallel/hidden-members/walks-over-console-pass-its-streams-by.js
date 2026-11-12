// Whoever goes over the enumerable properties of console never sees _stdout and _stderr. Bun's own formatter shows them.
import util from "node:util";

const seen = name => name === "_stdout" || name === "_stderr";
console.log(Object.keys(console).some(seen), Object.entries(console).some(([name]) => seen(name)));
console.log(Object.values(console).includes(process.stdout), Object.values(console).every(value => typeof value === "function"));

const spread = { ...console };
const assigned = Object.assign({}, console);
console.log(spread._stdout, assigned._stderr, typeof spread.log, typeof assigned.Console);

let inLoop = false;
for (const name in console) inLoop ||= seen(name);
console.log(inLoop);

console.log(JSON.stringify(console), JSON.stringify({ console }));
console.log(util.inspect(console).includes("_stdout"), util.inspect({ deep: { console } }, { depth: 4 }).includes("_stderr"));
console.log(util.inspect(console, { showHidden: true }).includes("_stdout"));
console.log(Bun.inspect(console).includes("_stdout"));
console.log(Bun.deepEquals(console, console), util.isDeepStrictEqual({ ...console }, { ...console }));
spread.log("the copy of log still prints");
