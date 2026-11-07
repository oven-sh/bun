// `kind === "circle"` in hot code first asks whether `kind` is an atom, and compares an atom with the atom of the text as a pointer. That arm is 61 bytes at each comparison, and
// comparisons are made in place in every loop, also in the loops of functions that are cold. There the characters answer: one application held 137 KB of such arms in cold functions.
import { expect } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "path";
import { run } from "./harness/run";
import { test } from "./supported";

const main = `function countKinds(text) {
  const list = JSON.parse(text);
  let circles = 0, squares = 0, others = 0;
  for (let i = 0; i < list.length; i++) {
    const kind = list[i].kind;
    if (kind === "circle") circles++;
    else others++;
    if (list[i].shade === "square") squares++;
  }
  return circles + ":" + squares + ":" + others;
}
function countOne(text) {
  const shape = JSON.parse(text);
  return (shape.kind === "circle" ? 1 : 0) + (shape.shade === "square" ? 2 : 0);
}
function onRareDays(day, text) {
  if (day === 1) return countOne(text);
  if (day === 2) return countKinds("[" + text + "]");
  return "";
}
console.log(onRareDays(process.argv.length - 1, '{"kind":"circle","shade":"square"}'), onRareDays(process.argv.length, '{"kind":"circle","shade":"round"}'));
`;

// The band of heat of countKinds and the bytes of its two comparisons.
async function comparisonsOf(flags: string[]) {
  using dir = tempDir("aot-cold-comparisons-with-texts", { "main.js": main });
  const cwd = String(dir);
  const executable = join(cwd, isWindows ? "main.exe" : "main");
  const map = join(cwd, "main.map");
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", ...flags, "./main.js", "--outfile", executable],
    cwd,
    {
      ...bunEnv,
      BUN_JSC_aotMapFilePath: map,
    },
  );
  expect({ output: built.exitCode ? built.stdout + built.stderr : "", exitCode: built.exitCode }).toEqual({
    output: "",
    exitCode: 0,
  });
  expect((await run([executable], cwd)).stdout).toBe("3 1:0:0\n");
  // F: a function with its number, name and band of heat. O: the bytes of each operation in the function of that number.
  const lines = readFileSync(map, "utf8")
    .split("\n")
    .map(line => line.split("\t"));
  const countKinds = lines.find(fields => fields[0] === "F" && fields[7] === "countKinds")!;
  const sizes = lines.find(fields => fields[0] === "O" && fields[1] === countKinds[1])!;
  return { band: countKinds[12], bytes: Number(sizes[sizes.indexOf("ValueEqualsLiteral") + 1]) };
}

// The bytes are x64's: 112 a comparison by the characters alone, 173 with the arm of the atoms in front.
test.skipIf(process.arch !== "x64")(
  "two comparisons with written texts in a loop of a cold function go by the characters alone",
  async () => {
    const { band, bytes } = await comparisonsOf([]);
    expect(band).toBe("c");
    expect(bytes).toBeGreaterThan(0);
    // A compiler with assertions writes its own checks into the code: 682 bytes a comparison.
    if (!isASAN && !isDebug) expect(bytes / 2).toBeLessThan(140);
  },
  240_000,
);
