// Above 256 MB of source, the checker's types are freed once, halfway through the files, and the first pass notes the
// cycles it entered for the checker of the second pass to enter again. `--aot-testing=Passes=<n>` makes that many passes
// of a small program. A question of Lower asks with nothing on the query stack, and a cycle that the answer closes there
// has no query to note. The build must not stop at it.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { slot, spawned, unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";

const env = { ...bunEnv, NO_COLOR: "1" };

// Nobody checks a JavaScript file, so Lower is the first to resolve the declared members of `Foo`. `[key]` is a computed
// name of no literal type, so the class gets an index signature whose type is the union of every member's type. `this`
// in it has the members of `Foo` with `this` as its argument, which nothing has resolved. The request for them finds the
// declared members in place: a cycle, closed with nothing on the stack.
const foo = `// A class with a computed member name and a member whose type is \`this\`.
export let f;
var key = "k";
class Foo {
  kind = "foo";
  [key] = 1;
  self = this;
}
f = new Foo();
console.log(f.kind, f.self === f);
`;

// The JavaScript file is put in the first pass, and the cut between the passes is made where the bytes of the files are
// about halved: in front of main.ts, which holds as many as the other two together.
const other = `export const other = 1;
// padding padding padding padding padding padding padding padding padding padding
// padding padding padding padding padding padding padding padding padding padding
`;
const main = `import { f } from "./foo.js";
import { other } from "./other";
console.log(f.kind, other);
// padding padding padding padding padding padding padding padding padding padding
// padding padding padding padding padding padding padding padding padding padding
// padding padding padding padding padding padding padding padding padding padding
// padding padding padding padding padding padding padding padding padding padding
`;

describe.skipIf(!!unsupported)("--aot-testing=Passes=2", () => {
  // The IR of the program and the counts of what was proven, built in that many passes.
  async function build(folder: string, passes: number) {
    const wire = join(folder, `passes-${passes}.ir`);
    const executable = join(folder, isWindows ? `program-${passes}.exe` : `program-${passes}`);
    const made = await spawned(
      [
        bunExe(),
        "build",
        "--compile",
        "--aot",
        `--aot-testing=Passes=${passes}`,
        "--explain=statistics",
        `--aot-out=${wire}`,
        "--outfile",
        executable,
        "main.ts",
      ],
      folder,
      { ...env, BUN_JSC_logAOTPhaseTimes: "1" },
    );
    expect({ exitCode: made.exitCode, stderr: made.stderr }).toMatchObject({ exitCode: 0 });
    const counts = `${made.stdout}\n${made.stderr}`
      .split("\n")
      .filter(line => /^ *(?:Accesses|Values)[A-Za-z]+:? +\d+ *$/.test(line))
      .map(line => line.trim());
    expect(counts).not.toBeEmpty();
    return { stderr: made.stderr, counts, ir: Bun.hash(readFileSync(wire)).toString(16), executable };
  }

  test("a cycle closed by a question of Lower stops no pass, and the passes answer as one does", () =>
    slot(async () => {
      using dir = tempDir("aot-passes", { "foo.js": foo, "other.ts": other, "main.ts": main });
      const folder = String(dir);
      const [plain, one, two] = await Promise.all([
        spawned([bunExe(), "main.ts"], folder, env),
        build(folder, 1),
        build(folder, 2),
      ]);
      expect(one.stderr).not.toContain("AOT passes of the checker | a cut");
      expect(two.stderr).toContain("AOT passes of the checker | a cut in front of file 1 of 2");
      expect({ counts: two.counts, ir: two.ir }).toEqual({ counts: one.counts, ir: one.ir });
      const ran = await spawned([two.executable], folder, env);
      expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
    }));
});
