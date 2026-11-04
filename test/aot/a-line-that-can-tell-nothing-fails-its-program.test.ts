// A program under parallel/ says in comment lines what the compiler makes of it, and shell/expectations.py asks them. A line that is met whatever the
// compiler makes is no check, and it looks like one. Each of these fails its program:
//   a line of a kind that nothing reads, or that is spelled so that nothing reads it
//   a line in a file of the program's folder that is not read
//   a line that says what must not be there and names an operation that no program has: the compiler may have lost it long ago
//   `// IR- <a declaration>[\s\S]*<a use of it>` where nothing is declared so
//   a pattern that finds nothing but itself: the dump quotes the text of the program, these lines included
// And the top-level code of a module that awaits is read where it is, not in the few operations that make its promise.
import { expect } from "bun:test";
import { tempDir } from "harness";
import { join } from "node:path";
import { unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";
import { run } from "./harness/run";
import { python, scriptEnvironment, scriptSkipReason } from "./shell/tools";

const joins = `function join(a: string, b: string): string { return a + "-" + b; }
const texts = process.argv.map(String);
console.log(join(texts[0], "x").length > 0, join("y", texts[0]).length > 0, [join].length);
`;
const programs = {
  "lines/lines-that-can-fail.ts": `// IRT= 1 join  = Strcat 
// IRT= 0 join  = StringBuilderBegin
${joins}`,
  "lines/what-the-others-say-is-absent.ts": `// IR+  = StringBuilderBegin
function numbers(count: number): string { let text = ""; for (let i = 0; i < count; i++) { text += i; text += ","; } return text; }
console.log(numbers(process.argv.length).length > 0, numbers(3), [numbers].length);
`,
  "lines/kinds-that-nothing-reads.ts": `// REMARK+ join Strcat: stack
// REMARK- join rejected
//IR= 1 join Strcat
  // CALLS- join Concatenate
// TODO: this is for people
// CALLS+ join Concatenate
// KNOWN g a
// IR-UNTIL X
${joins}`,
  "lines/in-another-file/main.ts": `import { join } from "./join";
console.log(join(String(process.argv.length), "x"));
`,
  "lines/in-another-file/join.ts": `// IRT= 1 join  = Strcat 
// REMARK+ join stack
export function join(a: string, b: string): string { return a + "-" + b; }
`,
  "lines/operations-that-no-compiler-has.ts": `// IRT= 0 join  = ConcatenateInTheFrame 
// IR- = Strcat .* \\[isBuiltInTheFrame\\]
// IRM= 0  = NewTextOfTheOldCompiler 
${joins}`,
  "lines/a-declaration-that-is-not-there.ts": `// IR- ^layout (L\\d+) .*name="Gone" [\\s\\S]* receivers=\\[\\1, \\.\\.\\]
// IR- ^layout (L\\d+) .*name="Kept" [\\s\\S]* receivers=\\[\\1, \\.\\.\\]
// IR+ ^layout (L\\d+) .*name="Kept" [\\s\\S]* receivers=\\[\\1\\]
class Kept { field = process.argv.length; }
const all: Kept[] = [];
for (let i = 0; i < process.argv.length; i++) all.push(new Kept());
function read(kept: Kept): number { return kept.field; }
console.log(read(all[0]) > 0, [read].length);
`,
  "lines/a-pattern-that-finds-itself.ts": `// IR+ JoinedInTheFrame
// IR+  = Strcat 
${joins}`,
  "lines/top-level-code-that-awaits.ts": `// IRM= 1  = Await\\w+ 
// IRM= 0  = StringBuilderBegin
console.log(await Promise.resolve(process.argv.length > 0));
`,
};

if (scriptSkipReason && !unsupported)
  console.error(`SKIPPED: test/aot/a-line-that-can-tell-nothing-fails-its-program.test.ts: ${scriptSkipReason}`);

test.skipIf(!!scriptSkipReason)(
  "a line that can tell nothing fails its program",
  async () => {
    using dir = tempDir("a-line-that-can-tell-nothing", {});
    const root = join(String(dir), "programs");
    for (const [name, text] of Object.entries(programs)) await Bun.write(join(root, name), text);
    const { stdout, stderr, exitCode } = await run(
      [python!, join(import.meta.dir, "shell", "expectations.py"), "all"],
      root,
      { ...scriptEnvironment(), PROGRAMS: root, WORK: join(String(dir), "work") },
    );
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(line => line !== "")).toEqual([
      `FAIL lines/a-declaration-that-is-not-there\t// IR- ^layout (L\\d+) .*name="Gone" [\\s\\S]* receivers=\\[\\1, \\.\\.\\]\tit cannot fail: nothing matches what it begins with, /^layout (L\\d+) .*name="Gone" /`,
      "FAIL lines/a-pattern-that-finds-itself\t// IR+ JoinedInTheFrame\tno line matches /JoinedInTheFrame/",
      "FAIL lines/in-another-file\t// IRT= 1 join  = Strcat \tonly main.ts is read, and this stands in join.ts",
      "FAIL lines/in-another-file\t// REMARK+ join stack\tonly main.ts is read, and this stands in join.ts",
      "FAIL lines/kinds-that-nothing-reads\t// REMARK+ join Strcat: stack\tnothing reads a line of this kind",
      "FAIL lines/kinds-that-nothing-reads\t// REMARK- join rejected\tnothing reads a line of this kind",
      "FAIL lines/kinds-that-nothing-reads\t//IR= 1 join Strcat\tnothing reads a line of this kind",
      "FAIL lines/kinds-that-nothing-reads\t  // CALLS- join Concatenate\tnothing reads a line of this kind",
      "FAIL lines/kinds-that-nothing-reads\t// CALLS+ join Concatenate\tnothing reads a line of this kind",
      "FAIL lines/kinds-that-nothing-reads\t// KNOWN g a\tnothing reads a line of this kind",
      "FAIL lines/kinds-that-nothing-reads\t// IR-UNTIL X\tnothing reads a line of this kind",
      "ok   lines/lines-that-can-fail: 2 expectations",
      "FAIL lines/operations-that-no-compiler-has\t// IRT= 0 join  = ConcatenateInTheFrame \tit cannot fail: the dump of no program holds ConcatenateInTheFrame",
      "FAIL lines/operations-that-no-compiler-has\t// IR- = Strcat .* \\[isBuiltInTheFrame\\]\tit cannot fail: the dump of no program holds isBuiltInTheFrame",
      "FAIL lines/operations-that-no-compiler-has\t// IRM= 0  = NewTextOfTheOldCompiler \tit cannot fail: the dump of no program holds NewTextOfTheOldCompiler",
      "ok   lines/top-level-code-that-awaits: 2 expectations",
      "ok   lines/what-the-others-say-is-absent: 1 expectations",
      "8 programs, 22 expectation lines: 5 programs fail; 0 lines are known failures",
    ]);
    expect(exitCode).toBe(1);
  },
  290_000,
);
