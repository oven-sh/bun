// harness/memory-limit.ts ends a child that holds more memory than it may. It does so however busy the thread is that started the child: the watching has a thread of its own.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { endAtMemoryLimit, endAtMemoryLimitTogether } from "./harness/memory-limit";

const MB = 2 ** 20;
// It comes to hold 512 MB and stands still there: should nobody look, the machine does not pay for it.
const grows = `const kept = []; while (kept.length < 4096) kept.push(new Array(1 << 14).fill(kept.length)); for (;;);`;
const started = () => Bun.spawn({ cmd: [bunExe(), "-e", grows], env: bunEnv, stdio: ["ignore", "ignore", "ignore"] });
/** Nothing else happens on this thread meanwhile: no timer, no message, no end of a child. */
function keepThisThreadBusy(seconds: number) {
  for (const until = performance.now() + seconds * 1000; performance.now() < until;);
}

test.skipIf(isWindows)(
  "a child that grows is ended while the thread that started it is busy",
  async () => {
    await using child = started();
    using held = endAtMemoryLimit(child, 128 * MB);
    keepThisThreadBusy(3);
    // Asked before this thread has taken a single turn of its event loop.
    expect(held.exceeded).toBe(true);
    if (process.platform === "linux") expect(held.held).toContain("VmRSS");
    await child.exited;
    expect(child.signalCode).toBe("SIGKILL");
  },
  60_000,
);

test.skipIf(isWindows)(
  "so are children that hold too much together",
  async () => {
    const { watch, hasRoom } = endAtMemoryLimitTogether(192 * MB);
    expect(hasRoom()).toBe(true);
    await using first = started();
    await using second = started();
    using ofFirst = watch(first);
    using ofSecond = watch(second);
    keepThisThreadBusy(3);
    expect([ofFirst.exceeded, ofSecond.exceeded]).toEqual([true, true]);
    expect(ofFirst.held).toContain("2 processes held together");
    expect(ofFirst.peak + ofSecond.peak).toBeGreaterThan(192 * MB);
    await Promise.all([first.exited, second.exited]);
    expect([first.signalCode, second.signalCode]).toEqual(["SIGKILL", "SIGKILL"]);
  },
  60_000,
);

test.skipIf(isWindows)(
  "a child that stays within its bound is left alone",
  async () => {
    await using child = Bun.spawn({ cmd: [bunExe(), "-e", `setTimeout(() => {}, 700);`], env: bunEnv, stdio: ["ignore", "ignore", "ignore"] }); // prettier-ignore
    using held = endAtMemoryLimit(child, 1024 * MB);
    keepThisThreadBusy(0.3);
    expect(await child.exited).toBe(0);
    expect([held.exceeded, held.held]).toEqual([false, ""]);
  },
  60_000,
);
