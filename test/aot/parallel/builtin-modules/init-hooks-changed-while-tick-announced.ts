// Init hooks changed while a tick is announced.
import { createHook } from "node:async_hooks";
import { writeSync } from "node:fs";

const lines: string[] = [];
let late: ReturnType<typeof createHook> | undefined;
const first = createHook({
  init(_id: number, type: string) {
    if (type !== "TickObject") return;
    lines.push("first");
    if (late === undefined) {
      late = createHook({
        init(_lateId: number, lateType: string) {
          if (lateType === "TickObject") lines.push("late");
        },
      }).enable();
    }
  },
});
const second = createHook({
  init(_id: number, type: string) {
    if (type !== "TickObject") return;
    lines.push("second");
    third.disable();
  },
});
const third = createHook({
  init(_id: number, type: string) {
    if (type === "TickObject") lines.push("third");
  },
});
first.enable();
second.enable();
third.enable();
process.nextTick(() => lines.push("tick 1"));
lines.push("--");
process.nextTick((a: number, b: string) => lines.push(`tick 2 ${a} ${b}`), 1, "x");
lines.push("--");
first.disable();
second.disable();
late!.disable();
process.nextTick(() => {
  lines.push("tick 3");
  writeSync(1, lines.join("\n") + "\n");
});
