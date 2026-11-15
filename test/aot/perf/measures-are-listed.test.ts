// A measure that nobody starts, and one whose imports are gone, hold nothing and say nothing. Sixteen of them once imported five names that their neighbor no longer exported.
import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const folder = import.meta.dir;
const measures = readdirSync(folder).filter(name => name.endsWith(".measure.ts"));
const textOf = (path: string) => readFileSync(path, "utf8");

test("every measure is in the list of measure.ts", () => {
  const listed = [...textOf(join(folder, "measure.ts")).matchAll(/^ {2}"\.\/(.+\.measure\.ts)",$/gm)].map(
    ([, name]) => name,
  );
  expect({
    missing: measures.filter(name => !listed.includes(name)).sort(),
    gone: listed.filter(name => !measures.includes(name)),
  }).toEqual({ missing: [], gone: [] });
});

// Two measures once named the folder of a program that was gone: the build of the program failed to start, and with an error that named another file.
test("what a file of this folder names beside itself is there", () => {
  const gone: string[] = [];
  for (const file of readdirSync(folder).filter(name => name.endsWith(".ts")))
    for (const [, words] of textOf(join(folder, file)).matchAll(/\bjoin\(import\.meta\.dir((?:, "[^"]+")+)\)/g)) {
      const path = join(folder, ...[...words.matchAll(/"([^"]+)"/g)].map(([, word]) => word));
      if (!existsSync(path)) gone.push(`${file}: there is no ${relative(folder, path)}`);
    }
  expect(gone).toEqual([]);
});

// Each name that a file of this folder takes from a file beside it or above it is one that that file exports.
const exportedBy = (text: string) =>
  new Set([
    ...[
      ...text.matchAll(
        /^export (?:declare )?(?:async )?(?:function\*?|const|let|class|type|interface|enum) ([\w$]+)/gm,
      ),
    ].map(([, name]) => name),
    ...[...text.matchAll(/^export (?:type )?\{([^}]*)\}/gm)].flatMap(([, names]) =>
      names.split(",").map(name =>
        name
          .replace(/^\s*(?:type )?/, "")
          .split(" as ")
          .at(-1)!
          .trim(),
      ),
    ),
  ]);
test("what a file of this folder imports is exported", () => {
  const wrong: string[] = [];
  for (const file of readdirSync(folder).filter(name => name.endsWith(".ts"))) {
    const text = textOf(join(folder, file));
    for (const [, names, from] of text.matchAll(/^import (?:type )?\{([^}]*)\} from "(\.{1,2}\/[^"]+)";$/gm)) {
      const base = join(dirname(join(folder, file)), from);
      const path = [base, base + ".ts", join(base, "index.ts")].find(
        path => /\.[a-z]+$/.test(path) && existsSync(path),
      );
      if (!path) {
        wrong.push(`${file}: there is no ${from}`);
        continue;
      }
      if (!path.endsWith(".ts")) continue;
      const exported = exportedBy(textOf(path));
      if (/^export \* from/m.test(textOf(path))) continue;
      for (const name of names
        .split(",")
        .map(name =>
          name
            .replace(/^\s*type /, "")
            .split(" as ")[0]
            .trim(),
        )
        .filter(Boolean))
        if (!exported.has(name)) wrong.push(`${file}: ${from} does not export ${name}`);
    }
  }
  expect(wrong).toEqual([]);
});
