// A module is imported by import() and required, and only some of its exports are read, all by name. What nothing reads is left out of the program, though the first `require` marks the namespace object that import() has made.
// IR- ^ .*only in the unread function
// IR+ ^ .*read through import
// IR+ ^ .*read through require
async function all(): Promise<void> {
  const ns = await import("./values");
  console.log(ns.throughImport(), (ns as any).__esModule);
  console.log(require("./values").throughRequire(), (ns as any).__esModule);
}
all();
