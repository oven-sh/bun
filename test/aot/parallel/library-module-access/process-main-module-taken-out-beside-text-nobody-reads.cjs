// process.mainModule, taken out by Object.entries, a spread and Object.values, in a program that also evaluates a text that the build cannot read.
// Alone: what another program of the executable names decides what this one finds.
const found = Object.entries(process).filter(([key]) => key.startsWith("mainM"));
console.log(found.map(([key, value]) => key + ":" + typeof value + " " + value.id).join());
console.log({ ...process }.mainModule === module, Object.values(process).filter(value => value === module).length);
console.log((0, eval)(process.argv[5] ?? "1 + 1"));
