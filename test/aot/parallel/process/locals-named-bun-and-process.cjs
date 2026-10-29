// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
{
  const process = { versions: {}, release: { name: "mine" } };
  console.log(
    process.isBun ? "bun" : "other",
    "bun" in process.versions,
    typeof process.versions.bun,
    process.release.name,
  );
}
{
  let Bun;
  console.log(typeof Bun, typeof Bun === "undefined" ? "other" : "bun");
}
function inner() {
  var process;
  function Bun() {}
  return [typeof process, typeof Bun];
}
console.log(inner().join());
{
  class process {
    static isBun = 0;
  }
  console.log(typeof process, process.isBun ? "bun" : "other");
}
try {
  throw undefined;
} catch (Bun) {
  console.log(typeof Bun === "undefined" ? "other" : "bun");
}
for (const process of [{ isBun: false }, { isBun: true }]) console.log(process.isBun ? "bun" : "other");
