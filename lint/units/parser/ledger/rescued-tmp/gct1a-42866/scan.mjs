const ts = new Bun.Transpiler({ loader: "ts" });
const tsx = new Bun.Transpiler({ loader: "tsx" });
const cases = [
  [ts, 'let g: (a = import("./x")) => void'],
  [ts, 'let g: (a = require("./x")) => void'],
  [ts, 'type A = { [import("./x")]: number }'],
  [ts, 'type A = { get a() { return import("./x") } }'],
  [ts, 'let x: import("./x", { with: { type: "json" } })'],
  [ts, 'let x: import("./x")'],
  [ts, 'let x: typeof import("./x")'],
  [tsx, 'let g: (a = <div/>) => void'],
  [ts, 'let g: (a = await 1) => void; export {}'],
  [ts, 'let g: (a = import.meta.url) => void'],
];
for (const [t, code] of cases) {
  for (const api of ["scanImports", "scan", "transformSync"]) {
    try {
      console.log(api.padEnd(13), JSON.stringify(code), "=>", JSON.stringify(t[api](code)));
    } catch (e) {
      console.log(api.padEnd(13), JSON.stringify(code), "ERR", e?.errors?.[0]?.message ?? e.message);
    }
  }
}
