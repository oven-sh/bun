// Reference: bun build --compile
// The first load of the file stands under a handler, so the file may run again and keeps its object. The bundle reads the name off that object. `bun <file>` lists its names, passes over this one and throws a SyntaxError.
try {
  await import("./importer.mjs");
} catch (error) {
  console.log(error.name, /hidden|quiet|level/.exec(error.message)?.[0]);
}
