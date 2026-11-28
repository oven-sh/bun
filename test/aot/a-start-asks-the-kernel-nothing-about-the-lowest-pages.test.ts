// A compiled program lets a read through null fault, and the handler of the fault throws the TypeError. For that the access must lie where nothing is mapped.
// Every target leaves one page unmapped at address 0, and a null check reaches no further. The compiler once let it reach 16 KB. A start then asked the kernel for each
// page below 16 KB wherever /proc/sys/vm/mmap_min_addr was less (RHEL has 4096), and the program ended before its first statement where the answer was not what Linux
// 4.17 or later gives an unfiltered process:
// - https://github.com/oven-sh/bun/issues/49476: Linux before 4.17 (RHEL 7, CentOS 7) ignores MAP_FIXED_NOREPLACE and maps somewhere else.
// - https://github.com/oven-sh/bun/issues/47177: a seccomp filter refuses mincore (AWS Lambda).
// No machine of CI is such a host, so a library in front of libc imitates both: ./a-start-asks-the-kernel-nothing-about-the-lowest-pages.c.
// Neither host has confirmed the library. What it does for a kernel before 4.17 is read from mm/mmap.c of Linux 3.10.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, tempDir } from "harness";
import { join } from "node:path";
import { cCompiler, without } from "./harness/capabilities";
import { slot, spawned } from "./harness/commands";
import { afterAll } from "./harness/default-timeout";
import { readers, sender } from "./harness/reads-of-null";
import { test } from "./supported";

// A Wide keeps each number in 8 bytes behind a header of 16, so its first field is read inside the first page and its last ones 5.6 KB into the object. The compiler
// lets the read of the first stand for the null check. In front of an access to the last ones it keeps a check of its own, which faults inside the page as well.
const fields = 700;
const program = /* ts */ `
import { readFileSync } from "node:fs";
${readers}
class Wide {
${Array.from({ length: fields }, (_, index) => `  f${index}: number = ${index}.5;`).join("\n")}
}
class Shelf { wide: Wide | null = null; }
const shelf = new Shelf();
function fillShelf() { shelf.wide = new Wide(); }
if (callsItself) fillShelf();
function insideThePage(): number { return callsItself ? insideThePage() : shelf.wide!.f0; }
function pastThePage(): number { return callsItself ? pastThePage() : shelf.wide!.f${fields - 1}; }
function storedPastThePage(): number { if (callsItself) return storedPastThePage(); shelf.wide!.f${fields - 2} = 1.5; return 1.5; }
const all = [inAField, atTheEndOfAChain, lackedByAMap, inAVariable, insideThePage, pastThePage, storedPastThePage];
function answersOfAll(): (string | number)[] {
  const answers: (string | number)[] = [];
  for (let i = 0; i < all.length; i++) {
    try {
      answers.push(all[i]());
    } catch (error) {
      answers.push((error as Error).constructor.name);
    }
  }
  return answers;
}
const throughNull = answersOfAll();
fill();
fillShelf();
const throughObjects = answersOfAll();
const mappedBelow16KB = readFileSync("/proc/self/maps", "utf8")
  .split("\\n")
  .filter(line => line && parseInt(line, 16) < 16384);
console.log(JSON.stringify({ throughNull, throughObjects, mappedBelow16KB }));
`;
const reads = 7;
const answered =
  JSON.stringify({
    throughNull: Array(reads).fill("TypeError"),
    throughObjects: [1, 1, 2, 3, 0.5, fields - 0.5, 1.5],
    mappedBelow16KB: [],
  }) + "\n";
// WTF asks for the lowest address that a process may map. The line shows that the library is in front of libc.
const asked = "low-pages: /proc/sys/vm/mmap_min_addr says 4096\n";
const hosts = ["kernel-before-4.17", "filtered-mincore"];

let dir: ReturnType<typeof tempDir> | undefined;
let whenBuilt: Promise<{ folder: string; executable: string; library: string }> | undefined;
const built = () =>
  (whenBuilt ??= slot(async () => {
    dir = tempDir("aot-lowest-pages", { "null-checks.ts": program, "sender.c": sender });
    const folder = String(dir);
    const library = join(folder, "lowest-pages.so");
    const executable = join(folder, "null-checks");
    const source = join(import.meta.dir, "a-start-asks-the-kernel-nothing-about-the-lowest-pages.c");
    const [compiledLibrary, compiledSender, compiledProgram] = await Promise.all([
      spawned([cCompiler!, "-O1", "-shared", "-fPIC", "-o", library, source, "-ldl"], folder, bunEnv),
      spawned([cCompiler!, "-w", "-o", "sender", "sender.c"], folder, bunEnv),
      spawned(
        [bunExe(), "build", "--compile", "--aot", join(folder, "null-checks.ts"), "--outfile", executable],
        folder,
        bunEnv,
      ),
    ]);
    expect({ stderr: compiledLibrary.stderr, exitCode: compiledLibrary.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(compiledSender.exitCode).toBe(0);
    expect(compiledProgram.exitCode).toBe(0);
    return { folder, executable, library };
  }));
afterAll(() => dir?.[Symbol.dispose]());

const on = (host: string, library: string) => ({
  ...bunEnv,
  LD_PRELOAD: bunEnv.LD_PRELOAD ? `${library}:${bunEnv.LD_PRELOAD}` : library,
  LOW_PAGES_HOST: host,
});

test.skipIf(!isLinux || !!without("a C compiler")).each(hosts)(
  "a compiled program starts on a host with mmap_min_addr 4096 and names no address below 16 KB to the kernel: %s",
  async host => {
    const { folder, executable, library } = await built();
    const there = await spawned([executable], folder, on(host, library));
    expect(there.stderr).toContain(asked);
    expect({ stdout: there.stdout, stderr: there.stderr.replaceAll(asked, ""), exitCode: there.exitCode }).toEqual({
      stdout: answered,
      stderr: "",
      exitCode: 0,
    });
  },
);

// A build that tests for null in front of each load raises no signal, and the case above would hold whatever a null check reaches.
test.skipIf(!isLinux || isASAN || !!without("a C compiler"))(
  "and there each of its reads through null is a fault, inside the first page or past it",
  async () => {
    const { folder, executable, library } = await built();
    const counted = await spawned([join(folder, "sender"), executable], folder, on(hosts[0], library));
    const [answers, raised] = counted.stdout.trimEnd().split("\n");
    expect({ answers: answers + "\n", raised: Number(raised), exitCode: counted.exitCode }).toEqual({
      answers: answered,
      raised: reads,
      exitCode: 0,
    });
  },
);
