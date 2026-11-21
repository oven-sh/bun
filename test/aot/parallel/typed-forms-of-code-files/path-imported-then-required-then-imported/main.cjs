// The import() that follows an import() and a require() under type "file" gets the code, as in an executable without --aot. Plain Bun fails there to evaluate the module.
// Reference: bun build --compile
(async () => {
  await import("./part.js", { with: { type: "file" } });
  require("./part.js", { type: "file" });
  console.log(Object.keys(await import("./part.js")).sort().join());
})();
