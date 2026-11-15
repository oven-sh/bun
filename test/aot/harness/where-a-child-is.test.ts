import { expect, test } from "bun:test";
import { isLinux } from "harness";
import { readFileSync } from "node:fs";
import { hasSmallHeap, saysWhereItIs } from "./where-a-child-is";

test.skipIf(!isLinux)(
  "a child that does not end says where its threads are, and not again while they stay there",
  async () => {
    const cmd = ["sh", "-c", "echo ready; read line"];
    await using child = Bun.spawn({ cmd, stdin: "pipe", stdout: "pipe", stderr: "ignore" });
    const reader = child.stdout.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("ready\n");
    reader.releaseLock();
    // The shell has printed, and reads next. The lists begin when it sleeps there: the state is the field behind the name.
    const state = () => {
      const stat = readFileSync(`/proc/${child.pid}/stat`, "utf8");
      return stat[stat.lastIndexOf(")") + 2];
    };
    const deadline = performance.now() + 2000;
    let last = state();
    while (last !== "S" && performance.now() < deadline) {
      await Bun.sleep(1);
      last = state();
    }
    expect(last).toBe("S");

    const said: string[] = [];
    using where = saysWhereItIs(child.pid, cmd, { first: 0, every: 20, span: 20, say: text => said.push(text) });
    // The shell sleeps in its read, and no list differs from the one before it. A shell that has ended gets no more lists.
    while (where.lists < 5 && child.exitCode === null && child.signalCode === null) await Bun.sleep(5);
    expect({ lists: where.lists >= 5, exitCode: child.exitCode, signalCode: child.signalCode }).toEqual({
      lists: true,
      exitCode: null,
      signalCode: null,
    });
    expect(said.length).toBeLessThanOrEqual(2);
    expect(said.at(-1)).toMatch(
      // Behind it: what the shell waits on in the kernel and the system call it is in, where the machine lets a parent read them.
      new RegExp(
        `^sh -c echo ready; read line \\(${child.pid}\\) has not ended after \\d+ s\\. Its threads:\\n  ${child.pid} sh: S, 0 ticks in 20 ms, `,
      ),
    );
  },
);

test("a child has a small heap when its environment limits the cell cage or the structure heap", () => {
  expect([
    hasSmallHeap({}),
    hasSmallHeap({ BUN_JSC_markedBlockCageSizeInMB: "64" }),
    hasSmallHeap({ BUN_JSC_structureHeapSizeInKB: "16384" }),
    // No cage: the heap has no limit.
    hasSmallHeap({ BUN_JSC_markedBlockCageSizeInMB: "0" }),
    hasSmallHeap({ BUN_JSC_markedBlockCageSizeInMB: "0", BUN_JSC_structureHeapSizeInKB: "16384" }),
    // The size that the engine chooses.
    hasSmallHeap({ BUN_JSC_structureHeapSizeInKB: "0" }),
    hasSmallHeap({ BUN_JSC_markedBlockCageSizeInMB: "64", BUN_JSC_structureHeapSizeInKB: "0" }),
  ]).toEqual([false, true, true, false, true, false, true]);
});
