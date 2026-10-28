// require.cache lists none of the modules of the executable, however it is walked, and no read of it throws. An executable built without --aot does the same.
const typed: { unrelated(): string } = require("./typed.ts");
const plain: { name: string } = require("./plain.cjs");
const data: { a: number } = require("./data.json");
const cache = require.cache as Record<string, unknown>;
function attempt(label: string, run: () => unknown) {
  try {
    console.log(label + ":", run());
  } catch (error: any) {
    console.log(label + ": throws", error.constructor.name, error.message);
  }
}
const last = (path: string) => path.split(/[\\/]/).pop();
attempt("keys", () => Object.keys(cache).map(last).join());
attempt("own names", () => Object.getOwnPropertyNames(cache).map(last).join());
attempt("own keys", () => Reflect.ownKeys(cache).map(String).map(last).join());
attempt("for in", () => {
  const seen: unknown[] = [];
  for (const key in cache) seen.push(last(key));
  return seen.join();
});
attempt("each key read", () =>
  Object.keys(cache)
    .map(key => typeof cache[key])
    .join(),
);
attempt("entries", () =>
  Object.entries(cache)
    .map(([key, value]) => last(key) + ":" + typeof value)
    .join(),
);
attempt("values", () =>
  Object.values(cache)
    .map(value => typeof value)
    .join(),
);
attempt("spread", () =>
  Object.keys({ ...cache })
    .map(last)
    .join(),
);
attempt("assign", () => Object.keys(Object.assign({}, cache)).map(last).join());
attempt("descriptors", () => Object.keys(Object.getOwnPropertyDescriptors(cache)).map(last).join());
for (const path of ["./typed.ts", "./plain.cjs", "./data.json"]) {
  attempt("read " + path, () => typeof cache[require.resolve(path)]);
  attempt("in " + path, () => require.resolve(path) in cache);
  attempt("has own " + path, () => Object.hasOwn(cache, require.resolve(path)));
  attempt("as written " + path, () => typeof cache[path]);
}
attempt("this file", () => typeof cache[__filename]);
attempt("no such file", () => typeof cache["/no/such/file.js"]);
attempt("a built-in module", () => typeof cache["node:fs"] + " " + typeof cache["fs"]);
attempt("Module._cache", () => require("node:module")._cache === cache);
console.log(typed.unrelated(), plain.name, data.a);
