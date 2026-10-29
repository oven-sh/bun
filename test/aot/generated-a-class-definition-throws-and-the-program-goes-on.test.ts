// Every scene of fuzz/a-class-definition-throws-and-the-program-goes-on.ts: something throws while a class is defined or first used, somebody catches it or nobody
// does, and the program goes on with what stood around the class. It prints what it prints in plain Bun.
import { isWritten, numberOfScenes, sceneAt, write } from "./fuzz/a-class-definition-throws-and-the-program-goes-on";
import { generated } from "./generated/run-generated";

// Every run takes these, whatever else it takes.
const onceWrong: number[] = [
  936, 940, 944, 946, 950, 956, 960, 966, 970, 2667, 2671, 2673, 2677, 2681, 2683, 2687, 2693, 2697,
];

generated(
  "a class definition throws and the program goes on as in plain Bun",
  Array.from({ length: numberOfScenes }, (_, index) => index)
    .filter(index => isWritten(sceneAt(index)))
    .map(index => ({
      name: `scene ${index}: ${Object.values(sceneAt(index)).join(", ")}.`,
      // Every run takes one scene in two hundred; AOT_GENERATED=all takes all.
      isAlwaysRun: index % 199 === 0,
      wasOnceWrong: onceWrong.includes(index),
      isOnlyCompiled: true as const,
      exitsAsPlainBunDoes: true as const,
      flags: [],
      make: () => write(sceneAt(index)),
    })),
);
