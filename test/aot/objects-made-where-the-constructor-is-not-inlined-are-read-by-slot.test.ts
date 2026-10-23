import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { built, slot, spawned } from "./run-programs";
import { test } from "./supported";

// The two objects are made in code that runs once, where the constructor is called and not inlined, and pass through text that the build cannot read.
const files = {
  "app.ts": `
    const rounds = Number(process.argv[2]);
    const throughUnseenCode = new Function("value", "return value" + (process.argv[3] ?? "")) as <V>(value: V) => V;
    function listOf(first: number): number[] {
      const list: number[] = [];
      for (let i = 0; i < 2; i++) list.push((first + i) | 0);
      return list;
    }
    class Entry {
      next: Entry;
      count: number;
      share: number;
      peer: Entry;
      list: number[];
      label: string;
      otherCount: number;
      otherShare: number;
      otherPeer: Entry;
      otherList: number[];
      otherLabel: string;
      constructor(seed: number) {
        this.next = this;
        this.count = seed | 0;
        this.share = seed + 0.5;
        this.peer = this;
        this.list = listOf(seed);
        this.label = "e" + seed;
        this.otherCount = (seed + 1) | 0;
        this.otherShare = seed + 1.5;
        this.otherPeer = this;
        this.otherList = listOf(seed + 1);
        this.otherLabel = "o" + seed;
      }
    }
    const first = throughUnseenCode(new Entry(1)), second = throughUnseenCode(new Entry(2));
    first.next = second;
    second.next = first;
    function walk(entry: Entry): Entry {
      return entry.next.next.next;
    }
    let entry = first;
    for (let round = 0; round < rounds; round++) entry = walk(entry);
    console.log(entry.count, entry.label, entry.peer === entry, entry.list.join(), entry.otherLabel);
  `,
};

const env = { ...bunEnv, NO_COLOR: "1" };
const testsOfTheCell = ["HasBirthFieldsFilled", "HasNoFieldOutsideSlot"];

function failuresByTest(map: string, counts: string) {
  const executions = new Map<number, number>();
  for (const line of readFileSync(counts, "utf8").split("\n")) {
    const [count, name] = line.split("\tbranch:");
    if (name !== undefined) executions.set(Number(name), Number(count));
  }
  const result: Record<string, { passed: number; failed: number }> = Object.fromEntries(
    testsOfTheCell.map(name => [name, { passed: 0, failed: 0 }]),
  );
  let sides: [number, number] | undefined;
  for (const line of readFileSync(map, "utf8").split("\n")) {
    const [letter, ...fields] = line.split("\t");
    if (letter === "Q") sides = [Number(fields[0]), Number(fields[1])];
    else if (letter === "q" && sides && fields[1] in result) {
      result[fields[1]].passed += executions.get(sides[0]) ?? 0;
      result[fields[1]].failed += executions.get(sides[1]) ?? 0;
    }
  }
  return result;
}

test(
  "an object whose constructor was called and not inlined passes the tests of its cell",
  () =>
    slot(async () => {
      using dir = tempDir("aot-constructor-not-inlined", files);
      const folder = String(dir);
      const executable = join(folder, isWindows ? "app.exe" : "app");
      const map = join(folder, "app.map");
      const counts = join(folder, "counts");
      built(
        await spawned(
          [bunExe(), "build", "--compile", "--aot", "--aot-count-branches", "app.ts", "--outfile", executable],
          folder,
          { ...env, BUN_JSC_aotMapFilePath: map },
        ),
      );
      expect(
        await spawned([executable, "1000"], folder, {
          ...env,
          BUN_DESTRUCT_VM_ON_EXIT: "1",
          BUN_JSC_aotCountsPath: counts,
        }),
      ).toMatchObject({ stdout: "1 e1 true 1,2 o1\n", exitCode: 0 });
      const failures = failuresByTest(map, counts);
      // A renamed test would count nothing.
      expect(testsOfTheCell.some(name => failures[name].passed + failures[name].failed > 0)).toBe(true);
      expect(Object.fromEntries(testsOfTheCell.map(name => [name, failures[name].failed]))).toEqual(
        Object.fromEntries(testsOfTheCell.map(name => [name, 0])),
      );
    }),
  300_000,
);
