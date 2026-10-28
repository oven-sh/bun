import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported-with-counted-calls";

const names = Array.from({ length: 40 }, (_, index) => "name" + index);
const head = `
  const parse = text => JSON.parse(process.argv.length > 90 ? "{}" : text);
  const box = parse(${JSON.stringify(JSON.stringify(Object.fromEntries(names.map((name, index) => [name, index]))))});
  const other = parse("{}");
  let sum = 0;
`;
const files = {
  "without.js": `${head}
  console.log(sum);
  `,
  "straight.js": `${head}
  ${names.map(name => `sum += box.${name}; other.${name} = sum;`).join("\n  ")}
  console.log(sum);
  `,
  "loop.js": `${head}
  for (let round = 0; round < Number(process.argv[2]); round++) {
    ${names.map(name => `sum += box.${name}; other.${name} = sum;`).join("\n    ")}
  }
  console.log(sum);
  `,
};

const filing = ["operationAOTGetByIdAndCache", "operationAOTPutByIdAndCache"];
const plain = ["operationAOTGetById", "operationAOTPutById"];

test("reads and stores by name in code that runs once fill no caches", async () => {
  using dir = tempDir("aot-code-that-runs-once-files-nothing", files);
  const counted = async (program: string, output: string, ...args: string[]) => {
    const executable = join(String(dir), program + (isWindows ? ".exe" : ""));
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", program + ".js", "--outfile", executable],
      String(dir),
      bunEnv,
    );
    expect(built.exitCode).toBe(0);
    const path = join(String(dir), "counts-" + program + args.join());
    const env = { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path };
    expect(await run([executable, ...args], String(dir), env)).toEqual({ stdout: output, stderr: "", exitCode: 0 });
    const counts: Record<string, number> = Object.fromEntries([...filing, ...plain].map(name => [name, 0]));
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const [count, name] = line.split("\toperation:");
      if (name !== undefined && name in counts) counts[name] = Number(count);
    }
    const sumOf = (list: string[]) => list.reduce((sum, name) => sum + counts[name]!, 0);
    return { filing: sumOf(filing), plain: sumOf(plain) };
  };
  const without = await counted("without", "0\n");
  const straight = await counted("straight", "780\n");
  const loop = await counted("loop", "39000\n", "50");
  const longerLoop = await counted("loop", "390000\n", "500");
  // The object itself answers the reads, without an operation.
  expect({ filing: straight.filing - without.filing, plain: straight.plain - without.plain }).toEqual({
    filing: 0,
    plain: names.length,
  });
  expect({
    files: loop.filing - without.filing >= names.length,
    filedAgain: longerLoop.filing - loop.filing,
    plain: longerLoop.plain - without.plain,
  }).toEqual({ files: true, filedAgain: 0, plain: 0 });
}, 240_000);
