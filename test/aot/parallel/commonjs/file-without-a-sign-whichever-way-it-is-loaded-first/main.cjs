// Files whose text says neither CommonJS nor ES module. Only the run shows whether a require() is still under way where import() loads one,
// or which of import() and require() comes first. Each says once whether it is strict code.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
const required = require("./required.mjs");
(async () => {
  await Promise.all([required.whileRequired, required.inCallback, required.inJob, required.inTick, required.inTimer]);
  await required.called();
  const imported = await import("./imported-then-required.cjs");
  console.log(Object.keys(imported), JSON.stringify(require("./imported-then-required.cjs")));
  console.log(
    JSON.stringify(require("./required-then-imported.cjs")),
    Object.keys(await import("./required-then-imported.cjs")),
  );
  const pending = import("./required-while-imported.cjs");
  console.log(JSON.stringify(require("./required-while-imported.cjs")), Object.keys(await pending));
  console.log(globalThis.seen.sort().join("\n"));
})();
