const cases = ["type as = 1;", "type as<T> = T;", "type as T;", "interface as {}", "interface as { a: 1 }\nx;", "interface as extends B {}", "namespace as { export const a = 1 }", "module as {}", "function f() { namespace as {} }", "type satisfies = 1;", "type /* c */ as = 1;", "type\nas = 1;", "let x = type as any;", "(type as any);", "type as unknown as number;", "interface as {} as any;", "declare type as = 1;", "type as = 1; type as2 = as;", "namespace as.b { export const c = 1 }", "type.as = 1;", "type as;", "x = type as = 1;"];
const out = [];
for (const src of cases) {
  for (const loader of ["ts", "tsx"]) {
    try { out.push("ok " + JSON.stringify(new Bun.Transpiler({ loader }).transformSync(src))); } catch (e) { out.push("ERR " + JSON.stringify((e.errors ?? [e]).map(x => x.message))); }
  }
}
console.log(Bun.hash(out.join("\n")).toString(36), out.length);
if (process.argv.includes("--show")) console.log(out.join("\n"));
