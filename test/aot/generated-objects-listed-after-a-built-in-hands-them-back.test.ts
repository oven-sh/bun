// The programs of fuzz/objects-listed-after-a-built-in-hands-them-back.ts: `process` along every road, and every other object along the roads
// on which the compiler does not follow it. What came back has the members it has in plain Bun.
import {
  generate,
  isUnseen,
  listings,
  nameOf,
  roads,
  subjects,
  type Subject,
} from "./fuzz/objects-listed-after-a-built-in-hands-them-back";
import { generated } from "./generated/run-generated";

const onceWrong = [
  "(await Promise.allSettled([$]))[0].value",
  "(await Promise.allSettled([Promise.reject($)]))[0].reason",
  "await Promise.any([Promise.reject($)]).catch(error => error.errors[0])",
];

function departsToday({ path }: Subject, road: string) {
  return (
    path === "timers" &&
    /ReadableStream|throwIfAborted|await Promise\.reject|reject\) => reject\(\$\)|made\.re(solve|ject)\(\$\)/.test(road)
  );
}

generated(
  "an object that a built-in hands back has the members it has in plain Bun",
  subjects.flatMap((subject, subjectIndex) =>
    roads.flatMap((road, roadIndex) => {
      if (subjectIndex > 0 && !isUnseen(road)) return [];
      const [label, listing] = listings[(roadIndex + subjectIndex) % listings.length];
      return {
        name: nameOf(subject, road, label),
        isAlwaysRun: subjectIndex === 0 && isUnseen(road),
        wasOnceWrong: subjectIndex === 0 && onceWrong.includes(road("$")),
        isOnlyCompiled: true as const,
        isBuiltAlone: true as const,
        ...(isUnseen(road) && departsToday(subject, road("$").replaceAll("\n", " "))
          ? { linesDepartToday: "a member that nobody names is not in the executable" }
          : {}),
        make: () => ({ file: "main.mjs", text: generate(subject, road, listing), files: subject.files }),
      };
    }),
  ),
);
