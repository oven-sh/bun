// Where code may come from disk, a name that the build does not know may find any file, and then nothing about the program is known.
// To the build an element of a list may be undefined, and so may what a table holds under it. require(undefined) throws, whatever lies on disk,
// so the build knows every name that finds something here, and the executable holds those two modules of the library and little else.
// Flags: --aot-allow-code-from-disk
// STATISTIC: ImageFunctionsEmitted <= 400
// STATISTIC: FlowEdgesLogged <= 30000
const table = { first: "os", second: "node:path" };
const kinds = [];
for (const key of Object.keys(table)) {
  const loaded = require(table[key]);
  kinds.push(`${key}: ${typeof loaded.platform} ${typeof loaded.join}`);
}
for (const name of [undefined, null, 5]) {
  try {
    require(name);
  } catch (error) {
    kinds.push(`${name}: ${error.code}`);
  }
}
console.log(kinds.join("\n"));
