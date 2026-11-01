import { expect } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { run } from "./harness/run";
import { test } from "./supported";

// The generic entrypoint of the async generator passes five captures, `this` and the callee in registers, and the fifth capture lands in the callee's register.
const main = `type More = { depth: number; names: string[] };
type Step = (label: string, settings: Settings, more: More) => AsyncGenerator<number, number, void>;
interface Settings { isShort?: boolean; limit?: number }

function streamOf<T>(start: () => AsyncGenerator<T, T, void>): { open: () => AsyncGenerator<T, T, void> } {
  return { open: start };
}

async function* count(label: string, settings: Settings, more: More): AsyncGenerator<number, number, void> {
  for (let i = 0; i < (settings.limit ?? 3); i++) yield label.length + i + more.depth;
  return more.names.length;
}

export function build(label: string, settings: Settings, step: Step, names: string[]) {
  const more: More = { depth: names.length, names };
  return streamOf(async function* () {
    const isShort = settings.isShort === true;
    try {
      return yield* step(isShort ? "" : label, settings, more);
    } finally {
      names.push("left");
    }
  });
}

const streams = [build("a", {}, count, ["a"]), build("bb", { isShort: true }, count, []), build("ccc", { limit: 2 }, count, ["a", "b"])];
(globalThis as any)[process.env.NO_SUCH_NAME ?? "handedOver"] = streams;
let sum = 0;
for (const stream of (globalThis as any).handedOver) for await (const n of stream.open()) sum += n;
console.log(sum);
`;

// At the default limit the ramp is inlined into its generic entrypoint.
const flags = ["--aot-limit=MaxWarmCodeValues:1"];

function imageOf(executable: Buffer) {
  const magic = Buffer.from("BUNAOT01", "latin1");
  for (let at = executable.indexOf(magic); at >= 0; at = executable.indexOf(magic, at + 1)) {
    if (at + 56 > executable.length) break;
    const size = Number(executable.readBigUInt64LE(at + 32));
    const codeOffset = Number(executable.readBigUInt64LE(at + 40));
    const codeSize = Number(executable.readBigUInt64LE(at + 48));
    if (codeSize > 0 && codeOffset + codeSize <= size && at + size <= executable.length)
      return executable.subarray(at, at + size);
  }
  throw new Error("the executable holds no image of compiled code");
}

async function build(cwd: string, folder: string, moreFlags: string[], environment: Record<string, string>) {
  const executable = join(cwd, folder, isWindows ? "main.exe" : "main");
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", ...flags, ...moreFlags, "./main.ts", "--outfile", executable],
    cwd,
    { ...bunEnv, ...environment },
  );
  expect({ output: built.exitCode ? built.stdout + built.stderr : "", exitCode: built.exitCode }).toEqual({
    output: "",
    exitCode: 0,
  });
  expect((await run([executable], cwd)).stdout).toBe("23\n");
  return executable;
}

test("BUN_JSC_aotMapFilePath does not change the image", async () => {
  using dir = tempDir("aot-map-file-same-image", { "main.ts": main });
  const cwd = String(dir);
  const map = join(cwd, "main.map");
  const [plain, withMap] = [
    await build(cwd, "plain", [], {}),
    await build(cwd, "mapped", [], { BUN_JSC_aotMapFilePath: map }),
  ];
  const [expected, image] = [imageOf(readFileSync(plain)), imageOf(readFileSync(withMap))];
  let differingBytes = Math.abs(expected.length - image.length);
  for (let at = 0; at < Math.min(expected.length, image.length); at++)
    differingBytes += Number(expected[at] !== image[at]);
  expect({ differingBytes, size: image.length }).toEqual({ differingBytes: 0, size: expected.length });

  const rows = readFileSync(map, "utf8")
    .split("\n")
    .map(line => line.split("\t"));
  const indexesOf = (kind: string) => rows.filter(fields => fields[0] === kind).map(fields => fields[1]);
  expect(indexesOf("F").length).toBeGreaterThan(100);
  expect(indexesOf("O")).toEqual(indexesOf("F"));
}, 240_000);

test("a forwarding entrypoint shorter than B3's code passes --aot-check=ValidateBackEnd", async () => {
  using dir = tempDir("aot-map-file-validate-back-end", { "main.ts": main });
  await build(String(dir), "validated", ["--aot-check=ValidateBackEnd"], {});
}, 240_000);
