// The file's throw comes through a required ES module while a call of import() is in flight. Each call's text comes in a task of its own: the first one runs the file and its retry gets the error, every other retry runs the file.
(async () => {
  await null;
  const load = async () => {
    try {
      return await import("./thrower.cjs");
    } catch (error) {
      try { return require("./thrower.cjs"); } catch (error) { return error.message + " " + globalThis.runs; }
    }
  };
  const first = load();
  try { require("./thrower.cjs"); } catch (error) { console.log("require threw", error.message, globalThis.runs); }
  console.log((await Promise.all([first, load(), load(), load()])).sort().join(", "), "runs", globalThis.runs);
})();
