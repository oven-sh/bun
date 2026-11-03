import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isGlibc, tempDir } from "harness";
import { join } from "node:path";
import { hasGuardedPages } from "./hardened";
import { run } from "./harness/run";
import { describe, test } from "./supported";

const isX64 = process.arch === "x64";
const lowestDrawnAddress = 64 * 2 ** 30;
const highestDrawnAddress = 124 * 2 ** 40;
const largestPageSize = 64 * 1024;
const guardSizeOfSecondStack = 256 * 1024;

const programThatListsItsMappings = `import { readFileSync } from "node:fs";
import { gzip } from "node:zlib";
await new Promise(resolve => gzip("on another thread", resolve));
console.log(readFileSync("/proc/self/maps", "utf8"));
`;

interface Mapping {
  from: number;
  to: number;
  access: string;
  path: string;
}

function readMappings(text: string): Mapping[] {
  return text
    .trim()
    .split("\n")
    .map(line => {
      const [range, access, , , , path = ""] = line.split(/ +/);
      const [from, to] = range.split("-").map(part => parseInt(part, 16));
      return { from, to, access, path };
    });
}

/** What has nothing mapped beside it but a stretch without access at either end, both of one size. */
function findGuardedMappings(mappings: Mapping[]) {
  const stretches: Mapping[][] = [];
  for (const mapping of mappings) {
    const last = stretches.at(-1);
    if (last?.at(-1)!.to === mapping.from) last.push(mapping);
    else stretches.push([mapping]);
  }
  const sizeOf = (mapping: Mapping) => mapping.to - mapping.from;
  const isGuard = (mapping: Mapping) => mapping.access === "---p" && !mapping.path;
  return stretches
    .filter(
      ([first, ...rest]) =>
        rest.length >= 2 && isGuard(first) && isGuard(rest.at(-1)!) && sizeOf(first) === sizeOf(rest.at(-1)!),
    )
    .map(([guard, first]) => ({ from: first.from, guardSize: sizeOf(guard) }));
}

async function startTwice() {
  using dir = tempDir("aot-hardened-mappings", { "program.ts": programThatListsItsMappings });
  const executable = join(String(dir), "program");
  const built = await run([
    bunExe(),
    "build",
    "--compile",
    "--aot",
    join(String(dir), "program.ts"),
    "--outfile",
    executable,
  ]);
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
  const starts = [];
  for (let start = 0; start < 2; start++) {
    const { stdout, stderr, exitCode } = await run([executable], undefined, bunEnv);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const mappings = readMappings(stdout);
    starts.push({
      guarded: findGuardedMappings(mappings),
      library: mappings.find(mapping => /\/(libc\.so|libc\.musl|ld-musl)[^/]*$/.test(mapping.path))!.from,
    });
  }
  return starts;
}

function expectAnAddressOfItsOwnEach(
  starts: Awaited<ReturnType<typeof startTwice>>,
  isWanted: (guardSize: number) => boolean,
  fewest: number,
) {
  const addresses: number[] = [];
  const distancesFromLibrary: number[] = [];
  for (const { guarded, library } of starts) {
    const wanted = guarded.filter(mapping => isWanted(mapping.guardSize));
    expect(wanted.length).toBeGreaterThanOrEqual(fewest);
    for (const { from } of wanted) {
      expect(from).toBeGreaterThanOrEqual(lowestDrawnAddress);
      expect(from).toBeLessThan(highestDrawnAddress);
      addresses.push(from);
      distancesFromLibrary.push(from - library);
    }
  }
  expect(new Set(addresses).size).toBe(addresses.length);
  expect(new Set(distancesFromLibrary).size).toBe(distancesFromLibrary.length);
}

describe.skipIf(!hasGuardedPages)("an executable of a Bun built with --hardened=on", () => {
  test("maps its instance and each of its tables between two pages without access, at an address drawn for it alone", async () => {
    expectAnAddressOfItsOwnEach(await startTwice(), guardSize => guardSize <= largestPageSize, 10);
  }, 120_000);

  test.skipIf(!isX64 || !isGlibc || isASAN)(
    "maps every thread's second stack at an address drawn for it alone",
    async () => {
      expectAnAddressOfItsOwnEach(await startTwice(), guardSize => guardSize === guardSizeOfSecondStack, 2);
    },
    120_000,
  );
});
