// Programs of fuzz/functions-that-keep-very-many-values-alive.ts with 66,000 values alive at once in one function, which is more places in a frame
// than sixteen bits count. The executable prints the sums that plain Bun prints.
import { isASAN, isDebug } from "harness";
import { namesOfKinds, namesOfShapes, write } from "./fuzz/functions-that-keep-very-many-values-alive";
import { generated } from "./generated/run-generated";

// Every run takes these, whatever else it takes.
const onceWrong = ["used-in-reverse integers", "used-in-a-loop mixed", "used-in-a-catch integers"];

generated(
  "functions keep very many values alive",
  // A sanitizer or debug build compiles such a function many times slower.
  (isASAN || isDebug ? [] : namesOfShapes).flatMap(shape =>
    namesOfKinds.map(kind => ({
      name: `${shape} ${kind}.`,
      isAlwaysRun: false,
      wasOnceWrong: onceWrong.includes(`${shape} ${kind}`),
      isOnlyCompiled: true as const,
      make: () => ({ file: "main.js", text: write(shape, kind, 66_000) }),
    })),
  ),
);
