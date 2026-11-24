// `new RegExp(`(?! )${gap}|(?<=^|${gap}) `, "gu")`, with `gap` put together out of the sources of written patterns. The build works out such a text and the executable has machine code for it.
// A test run had none. A test may replace RegExp there, and whether one does is settled late, so the build saw no function call RegExp at all: every pattern that a file puts together
// was parsed when the test ran and matched by the interpreter.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(240_000);

const rows = `["  a\\u2800b  c ", "\\u2500\\u2502 x \\u3164 y \\u2502\\u2500", "plain text with  two", "\\uFFFCz z\\u00a0", ""]`;
const inTest = (imports: string, deed: string) => `
import { expect, test } from "bun:test";
${imports}
test("the patterns", () => {
  const rows = ${rows};
  const said = [];
  for (let turn = 0; turn < 50; turn++) said.push(${deed});
  console.log(JSON.stringify(said.slice(0, 5)));
  expect(said.length).toBe(50);
});
`;

const cases: Record<string, { files: Record<string, string>; texts: number }> = {
  "a template over the sources of patterns that another file writes": {
    files: {
      "classes.ts": `export const HOLLOW = /[\\u2800\\u3164\\u115F]/gu;\nexport const ODD = /[\\u{1D159}\\u{13441}\\uFFFC]/gu;\n`,
      "clean.ts": `
        import { HOLLOW, ODD } from "./classes";
        const GAP = \`(?:\\\\p{White_Space}|\${HOLLOW.source}|\${ODD.source}|\\\\p{Default_Ignorable_Code_Point})\`;
        const EDGES = new RegExp(\`(?! )\${GAP}|(?<=^|\${GAP}) | (?=$|\${GAP})\`, "gu");
        export function clean(text: string): string { return text.replace(EDGES, ""); }
        export async function later(text: string): Promise<string> { return clean(text); }
      `,
      "a.test.ts": inTest(`import { clean } from "./clean";`, `clean(rows[turn % rows.length])`),
    },
    texts: 1,
  },
  "a list that is joined, in the file of the tests itself": {
    files: {
      "a.test.ts": inTest(
        `const words = ["plain", "two", "[a-c]+"]; const any = RegExp("\\\\b(?:" + words.join("|") + ")\\\\b", "g");`,
        `rows[turn % rows.length].replace(any, "<$&>")`,
      ),
    },
    texts: 1,
  },
  "a table of rules, each made a pattern by a function that is called back": {
    files: {
      "rules.ts": `
        const rules = [{ name: "word", source: "[a-z]+" }, { name: "gap", source: "\\\\s{2,}" }, { name: "odd", source: "[^\\\\x00-\\\\x7f]" }];
        export const patterns = rules.map(rule => ({ name: rule.name, pattern: new RegExp("(?:" + rule.source + ")", "gu") }));
      `,
      "a.test.ts": inTest(
        `import { patterns } from "./rules";`,
        `patterns.map(one => (rows[turn % rows.length].match(one.pattern) ?? []).length).join()`,
      ),
    },
    texts: 3,
  },
  "words that calls lay into a list, joined at the first use": {
    files: {
      "words.ts": `
        const words: string[] = [];
        export function add(word: string): void { words.push(word); }
        let all: RegExp | undefined;
        export function mark(text: string): string { all ??= new RegExp("\\\\b(" + words.join("|") + ")\\\\b", "g"); return text.replace(all, "<$1>"); }
      `,
      "setup.ts": `import { add } from "./words";\nadd("plain");\nadd("two");\nadd("x");\n`,
      "a.test.ts": inTest(`import "./setup";\nimport { mark } from "./words";`, `mark(rows[turn % rows.length])`),
    },
    texts: 1,
  },
};

function countsIn(path: string) {
  const counts: Record<string, number> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const [count, name] = line.split("\tcounter:");
    if (name?.includes("RegExp")) counts[name] = (counts[name] ?? 0) + Number(count);
  }
  return counts;
}
const said = (output: string) => output.split("\n").filter(line => line.startsWith("["));

for (const [name, { files, texts }] of Object.entries(cases)) {
  test(name, async () => {
    using dir = tempDir("aot-patterns-of-a-test-run", files);
    const plain = await run([bunExe(), "test", "./a.test.ts"], String(dir), bunEnv);
    const path = join(String(dir), "counts");
    const compiled = await run([bunExe(), "test", "--aot", "./a.test.ts"], String(dir), {
      ...bunEnv,
      BUN_JSC_aotCountsPath: path,
    });
    expect({ said: said(compiled.stdout), exitCode: compiled.exitCode }).toEqual({
      said: said(plain.stdout),
      exitCode: 0,
    });
    expect(said(plain.stdout).length).toBe(1);
    const counts = countsIn(path);
    expect({
      given: counts.PredictedRegExpsGivenCode,
      withoutRecord: counts.RegExpsCreatedWithoutRecord,
      interpreted: counts.RegExpMatchesInterpreted,
    }).toEqual({
      given: texts,
      withoutRecord: 0,
      interpreted: 0,
    });
  });
}

// Whoever builds the product is told which of its patterns have no code. A test run was never told, and is not told now.
test("a text that only the run knows", async () => {
  using dir = tempDir("aot-patterns-of-a-test-run", {
    "a.test.ts": inTest(
      `const word = new RegExp(process.env.WORD_OF_THE_RUN ?? "pl" + "ain", "g");`,
      `rows[turn % rows.length].replace(word, "<$&>")`,
    ),
  });
  const env = { ...bunEnv, WORD_OF_THE_RUN: "t[a-z]+" };
  const plain = await run([bunExe(), "test", "./a.test.ts"], String(dir), env);
  const compiled = await run([bunExe(), "test", "--aot", "./a.test.ts"], String(dir), env);
  expect({ said: said(compiled.stdout), exitCode: compiled.exitCode }).toEqual({
    said: said(plain.stdout),
    exitCode: 0,
  });
  expect(compiled.stdout + compiled.stderr).not.toContain("regular expression");
});

// The list of texts claims nothing: where a test does replace RegExp, its records are asked for by nobody.
test("a test that replaces RegExp gets its own", async () => {
  using dir = tempDir("aot-patterns-of-a-test-run", {
    "clean.ts": `
      const gap = "\\\\s" + "+";
      export function clean(text: string): string { return text.replace(new RegExp(gap, "g"), "_"); }
    `,
    "a.test.ts": `
      import { expect, test } from "bun:test";
      import { clean } from "./clean";
      test("replaced", () => {
        const original = globalThis.RegExp;
        const asked: string[] = [];
        globalThis.RegExp = function (pattern: string, flags: string) { asked.push(pattern + "/" + flags); return new original("b", flags); } as any;
        try {
          console.log(JSON.stringify([clean("a b  c"), asked]));
        } finally {
          globalThis.RegExp = original;
        }
        console.log(JSON.stringify([clean("a b  c"), asked]));
        expect(asked.length).toBe(1);
      });
    `,
  });
  const plain = await run([bunExe(), "test", "./a.test.ts"], String(dir), bunEnv);
  const compiled = await run([bunExe(), "test", "--aot", "./a.test.ts"], String(dir), bunEnv);
  expect({ said: said(compiled.stdout), exitCode: compiled.exitCode }).toEqual({
    said: said(plain.stdout),
    exitCode: 0,
  });
  expect(said(plain.stdout)).toEqual([`["a _  c",["\\\\s+/g"]]`, `["a_b_c",["\\\\s+/g"]]`]);
});
