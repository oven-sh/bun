// A .cjs file that names no exports is an ES module to import(): it runs once, and everyone gets its error.
(async () => {
  const calls = [1, 2, 3].map((number) => import("./thrower.cjs").catch((error) => "call " + number + ": " + error.message));
  console.log((await Promise.all(calls)).join(", "));
  for (const turn of [1, 2, 3]) {
    try { require("./thrower.cjs"); } catch (error) { console.log("require", turn, error.message); }
  }
  console.log("runs", globalThis.runs);
})();
