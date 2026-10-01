import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bun } from "./lint-helpers";

type Report = { line: number; column: number; message: string };
// The extension of the file of a case that is not `.js` or, with `jsx`, `.jsx`. For a TypeScript one, `eslint` is the answer of ESLint with typescript-eslint's parser.
type Ext = "ts" | "tsx" | "mts" | "cts" | "mjs" | "cjs";
// `eslintTest`: the case is in ESLint's own test of the rule. `differs`: how ESLint's answer, in `eslint`, is another.
type Case = {
  code: string;
  jsx?: true;
  ext?: Ext;
  expect: Report[];
  differs?: string;
  eslint?: Report[];
  eslintTest?: true;
};

const rulesDir = join(import.meta.dir, "rules");
// `rules/<rule>.json` holds the cases of one rule.
const rules = [...new Bun.Glob("*.json").scanSync(rulesDir)].map(file => file.slice(0, -".json".length)).sort();
const fixtures: Record<string, Case[]> = Object.fromEntries(
  rules.map(rule => [rule, JSON.parse(readFileSync(join(rulesDir, `${rule}.json`), "utf8"))]),
);
const extOf = (c: Case) => c.ext ?? (c.jsx ? "jsx" : "js");
// The file that a case is for `bun --lint`: its extension and its text.
const key = (c: Case) => `${extOf(c)}:${c.code}`;
const keys = new Map(rules.map(rule => [rule, new Set(fixtures[rule].map(key))]));

describe("bun --lint rules", () => {
  test.concurrent.each(rules)("%s", async rule => {
    const cases = fixtures[rule];
    // Each case is a file of its own and one run checks them all.
    const names = cases.map((c, i) => `c${String(i).padStart(4, "0")}.${extOf(c)}`);
    const indexOf = new Map(names.map((name, i) => [name, i]));
    using dir = tempDir(`lint-${rule}`, Object.fromEntries(cases.map((c, i) => [names[i], c.code])));
    const { stdout, stderr, exitCode } = await bun(String(dir), ["--lint", ...names]);

    // The plain format writes a line break inside a message as one space.
    const expected = cases.map((c, i) =>
      c.expect.map(r => `${names[i]}(${r.line},${r.column}): error ${rule}: ${r.message.replace(/\r\n?|\n/g, " ")}`),
    );
    const received: string[][] = cases.map(() => []);
    const unexpected: string[] = [];
    for (const line of stderr.split("\n").filter(Boolean)) {
      const [, name, category, code] = /^(c\d+\.[a-z]+)\(\d+,\d+\): (\w+) ([\w-]+): /.exec(line) ?? [];
      const index = indexOf.get(name);
      const other = keys.get(code);
      if (index === undefined) unexpected.push(line);
      else if (code === rule) received[index].push(line);
      // The test of another rule checks a line of that rule, so the cases of that rule have to have this one too.
      // A warning of the parser is not a report of a rule.
      else if (other ? !other.has(key(cases[index])) : !(category === "warning" && code === "syntax"))
        unexpected.push(line);
    }
    const wrong = cases
      .map((c, i) => ({ code: c.code, expected: expected[i], received: received[i] }))
      .filter(c => !Bun.deepEquals(c.received, c.expected));

    expect({ stdout, unexpected, wrong, exitCode }).toEqual({ stdout: "", unexpected: [], wrong: [], exitCode: 2 });
  });
});
