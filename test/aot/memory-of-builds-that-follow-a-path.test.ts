import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// The path of the read depends on what is stored in `name`, so the build follows the statements of the file. Without the store it doesn't.
const read = (stores: boolean) => `
${stores ? `let name = "one";\nif (process.env.PICK) name = "two";` : `const name = process.env.PICK ? "two" : "one";`}
console.log(fs.existsSync(path.join(__dirname, name + ".txt")));
`;
const head = `const fs = require("fs"), path = require("path");\n`;
const usage = Buffer.alloc(170_000 * 6, "usage ").toString();
const numbers = (count: number) => Array.from({ length: count }, (_, index) => index);
const shapes: Record<string, (count: number) => string> = {
  "members that choose by the environment": count => `const USAGE = "${usage}";
const settings = {
${numbers(count)
  .map(index => `  opt${index}: process.env.OPT${index} || "d${index}",`)
  .join("\n")}
};
console.log(USAGE.length, Object.keys(settings).length);
`,
  "items that choose by the environment": count => `const USAGE = "${usage}";
const settings = [
${numbers(count)
  .map(index => `  process.env.OPT${index} ? "a${index}" : "d${index}",`)
  .join("\n")}
];
console.log(USAGE.length, settings.length);
`,
  "variables that choose by the environment": count => `const USAGE = "${usage}";
${numbers(count)
  .map(index => `const opt${index} = process.env.OPT${index} ?? "d${index}";`)
  .join("\n")}
console.log(USAGE.length, typeof opt0);
`,
  "calls in a try": count => `const conv = globalThis.Number;
try {
${numbers(count)
  .map(index => `  var v${index} = conv("${index}");`)
  .join("\n")}
} catch (error) {
  console.log(error.message);
}
console.log(v${count - 1});
`,
  "calls outside a try": count => `const conv = globalThis.Number;
${numbers(count)
  .map(index => `var v${index} = conv("${index}");`)
  .join("\n")}
console.log(v${count - 1});
`,
};
const megabyte = 1 << 20;

async function build(source: string) {
  using dir = tempDir("aot-memory-of-followed-paths", { "main.cjs": source, "one.txt": "one", "two.txt": "two" });
  const cwd = String(dir);
  const outfile = join(cwd, "built.exe");
  await using built = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "./main.cjs", "--outfile", outfile],
    cwd,
    env: { ...bunEnv, MIMALLOC_PURGE_DELAY: "0" },
    stdout: "ignore",
    stderr: "pipe",
  });
  const stderr = await built.stderr.text();
  expect({ stderr: (await built.exited) ? stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const plain = await run([bunExe(), "run", "./main.cjs"], cwd);
  expect(plain.exitCode).toBe(0);
  expect(await run([outfile], cwd)).toEqual(plain);
  return Math.round(built.resourceUsage()!.maxRSS / megabyte);
}

test.skipIf(isDebug || isASAN || isWindows).each([
  ["members that choose by the environment", 4],
  ["members that choose by the environment", 8],
  ["members that choose by the environment", 16],
  ["items that choose by the environment", 16],
  ["variables that choose by the environment", 16],
  ["calls in a try", 1_500],
  ["calls in a try", 3_000],
  ["calls in a try", 6_000],
  ["calls outside a try", 6_000],
])("%s, %i, take no more memory where a path is followed", async (shape, count) => {
  const followed = await build(head + shapes[shape](count) + read(true));
  const plain = await build(head + shapes[shape](count) + read(false));
  console.log(`MEMORY ${shape}, ${count}: ${followed} MB, without the store ${plain} MB`);
  expect(followed).toBeLessThan(plain + 64);
});
