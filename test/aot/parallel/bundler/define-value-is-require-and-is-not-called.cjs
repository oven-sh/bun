// A `--define` whose value is `require` reads the `require` of the file where the defined name is not called: under `typeof`, and as the holder of `main`, `cache` and `resolve`.
// Flags: --define REQ=require --define RESOLVE=require.resolve
globalThis.require = "the global";
console.log(
  typeof REQ,
  REQ.main === module,
  typeof REQ.cache,
  REQ.resolve("node:path"),
  RESOLVE("node:fs"),
  typeof RESOLVE,
);
