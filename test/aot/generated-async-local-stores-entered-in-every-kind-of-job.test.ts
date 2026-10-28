// Fixed seeds of fuzz/async-local-stores-entered-in-every-kind-of-job.ts: two AsyncLocalStorage objects, each made at a time of its own, are
// entered, run, left, bound and snapshotted inside promise jobs, ticks, timers, listeners, callbacks of the file system and requests.
// Every step writes down what both stores hold.
import { generate } from "./fuzz/async-local-stores-entered-in-every-kind-of-job";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "an async local store holds in every job what it holds in plain Bun",
  Array.from({ length: 160 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first sixteen seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 16,
    isOnlyCompiled: true as const,
    flags:
      index % 4 === 3 ? ["--aot-heat=everything-is-hot"] : index % 4 === 2 ? ["--aot-heat=everything-is-cold"] : [],
    make: () => ({ file: "main.mjs", text: generate(new Random(index + 1)) }),
  })),
);
