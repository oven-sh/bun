// An ES module imports a name that the CommonJS file has not stored when the copy is taken: a SyntaxError at link. The CommonJS file has run, the importer has not.
try {
  await import("./importer.mjs");
} catch (error) {
  console.log(error.constructor.name);
}
