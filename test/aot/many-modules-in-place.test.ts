import { expect, setDefaultTimeout, test } from "bun:test";
import { bunExe, isASAN, isDebug, tempDir } from "harness";
import { run } from "./harness/run";

setDefaultTimeout(120_000);

const modules = 3000;
const exportsOfEach = 10;

function files(): Record<string, string> {
  const made: Record<string, string> = {};
  for (let i = 0; i < modules; i++) {
    const lines: string[] = [];
    if (i) lines.push(`import * as before from "./m${i - 1}";`, `import { f${i - 1}_0 } from "./m${i - 1}";`);
    for (let j = 0; j < exportsOfEach; j++) {
      const more = i && j === 0 ? ` + f${i - 1}_0(x) + before.f${i - 1}_1(x)` : "";
      lines.push(`export function f${i}_${j}(x: number): number { return (x + ${j}${more}) % 1000; }`);
    }
    made[`m${i}.ts`] = lines.join("\n") + "\n";
  }
  made["main.test.ts"] = `
    import { test, mock } from "bun:test";
    import * as last from "./m${modules - 1}";
    const handedOn = [mock];
    test("case", () => {
      console.log("see:", last.f${modules - 1}_0(1), handedOn.length);
    });
  `;
  return made;
}

async function seen(cwd: string, args: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), ...args], cwd);
  return { seen: (stdout + stderr).split("\n").filter(line => line.startsWith("see:")), exitCode };
}

test.skipIf(isDebug || isASAN)(
  "the work of a test build grows with the number of its modules, not with the square of it",
  async () => {
    using dir = tempDir("many-modules-in-place", files());
    const plain = await seen(String(dir), ["test", "./main.test.ts"]);
    expect(plain.seen.length).toBe(1);
    // From the sources, and as compiled code.
    for (const flag of ["--aot", "--debug-aot"])
      expect({ flag, ...(await seen(String(dir), ["test", flag, "./main.test.ts"])) }).toEqual({ flag, ...plain });
  },
  40_000,
);
