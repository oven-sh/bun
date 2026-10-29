// process.mainModule, taken out by Object.entries in a program in which no file names a way to a module object.
// Alone: what another program of the executable names decides what this one finds.
// Flags: --aot-disable=flow-results
const found = Object.entries(process).filter(([key]) => key.startsWith("mainM"));
console.log(found.map(([key, value]) => key + ":" + typeof value + " " + value.id).join());
