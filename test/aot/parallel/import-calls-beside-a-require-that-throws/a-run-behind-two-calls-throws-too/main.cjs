// The run that the second call's fetch allows throws as well: its error is that require()'s alone, later ones get the first error.
(async () => {
  const calls = [1, 2, 3].map((number) => import("./thrower.cjs").catch((error) => "call " + number + ": " + error.message));
  console.log((await Promise.all(calls)).join(", "));
  for (const turn of [1, 2, 3]) {
    try { require("./thrower.cjs"); } catch (error) { console.log("require", turn, error.message); }
  }
  console.log("runs", globalThis.runs);
})();
