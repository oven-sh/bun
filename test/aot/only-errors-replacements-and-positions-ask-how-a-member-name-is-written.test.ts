// A build parses `x["name"]` into the node of `x.name`, so what decides how a program is compiled cannot tell the two apart. The node keeps one bit: written in brackets.
// Three readers show the text as written to somebody, and only they ask for it: TypeScript's rules, whose errors differ for the two, what `bun build` replaces only behind a dot,
// and the positions and texts in the errors of a run. Goes by the text of the front end's sources. tools/same-code-in-every-spelling.test.ts asks the same of whole programs.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..", "..");
const folders = ["src/aot", "src/bundler/aot", "src/sema"];
const asks = /\b(BRACKET_ACCESS|is_written_in_brackets|written_kind|checked_kind|is_name_resolved_by_transpiler)\b/;

const holdsTheBit = /^src\/sema\/(hir\.rs$|hir\/|parser\/)/;
const followsTypeScript = /^src\/sema\/(node\.rs$|check\/(?!aot\/)|bind\/(?!runtime\/|static_referent\/))/;

// THIS LIST ONLY EVER GETS SHORTER.
const others: Record<string, string> = {
  "src/aot/compile/removable.rs":
    "a member of an enum whose name is not ASCII: `bun build` puts its value there only behind a dot",
  "src/aot/lower/call/callee.rs": "where an error of the run points, and the text of a callee in its message",
  "src/sema/check/aot/enum_constants.rs":
    "a member of an enum whose name is not ASCII: `bun build` puts its value there only behind a dot",
  "src/sema/fold/folder_names.rs":
    "`process.env.NAME`, `process.platform` and what --define names: `bun build` puts a value there only behind a dot",
};

test("only errors, replacements and positions ask how the name of a member is written", () => {
  const found: string[] = [];
  for (const folder of folders)
    for (const name of readdirSync(join(root, folder), { recursive: true }).map(String)) {
      const path = `${folder}/${name.replaceAll("\\", "/")}`;
      if (!path.endsWith(".rs") || /(^|\/)(tests|source_tests)(\/|\.rs$)|_tests\.rs$/.test(path)) continue;
      if (holdsTheBit.test(path) || followsTypeScript.test(path)) continue;
      if (asks.test(readFileSync(join(root, path), "utf8"))) found.push(path);
    }
  expect(found.sort()).toEqual(Object.keys(others));
});
