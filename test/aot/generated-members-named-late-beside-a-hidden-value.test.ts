import { holders, textOf } from "./generated/members-named-late-beside-a-hidden-value";
import { generated } from "./generated/run-generated";
import { schedules } from "./harness/flow-schedules";

const alwaysRun = new Set(["Bun", "process", "globalThis", "node:fs"]);

generated(
  "every member of a holder is named long after the holder has left",
  holders.flatMap(holder =>
    Object.entries(schedules).map(([schedule, flags]) => ({
      name: `${holder.name}, the ${schedule} schedule`,
      isAlwaysRun: alwaysRun.has(holder.name),
      isOnlyCompiled: true as const,
      flags,
      make: () => ({ file: "main.mjs", text: textOf(holder) }),
    })),
  ),
);
