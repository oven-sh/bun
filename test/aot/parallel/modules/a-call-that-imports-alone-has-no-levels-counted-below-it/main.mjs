// A call of import() that no other call waits beside comes first whatever lies below its file: nobody goes through the graph to count how deep it is.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
// COUNT: sought:ModulesForLevelsBelowImports = 0
// COUNT: counter:CompiledModulesWalkedByLoader = 0
globalThis.ran = [];
const first = await import("./a-1.mjs");
const second = await import("./b-1.mjs");
async function later() {
  return (await import("./c-1.mjs")).name;
}
console.log(first.name, second.name, await later(), globalThis.ran.join(" "));
