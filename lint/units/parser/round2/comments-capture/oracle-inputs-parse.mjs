import { readFileSync } from "node:fs";
const base = "/workspace/notes/lint/units/parser/lexer-lint-hooks/";
const bu = JSON.parse(readFileSync(base + "bottom-up/comments-inputs.json", "utf8")).map(([name, loader, code]) => ["bu:" + name, loader, code]);
const td = JSON.parse(readFileSync(base + "top-down/comments-inputs.json", "utf8")).map(([file, code]) => ["td:" + file, file.split(".").pop(), code]);
let ok = 0;
for (const [name, loader, code] of [...bu, ...td]) {
  try {
    new Bun.Transpiler({ loader }).transformSync(code);
    ok++;
  } catch (e) {
    console.log("REJECT", name, "[" + loader + "]", String(e?.message ?? e).split("\n")[0].slice(0, 80), e?.errors?.[0]?.message ?? "");
  }
}
console.log("ok", ok, "of", bu.length + td.length, Bun.revision.slice(0, 10));
