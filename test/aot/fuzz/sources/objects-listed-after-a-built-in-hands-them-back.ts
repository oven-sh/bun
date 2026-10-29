// The programs of fuzz/objects-listed-after-a-built-in-hands-them-back.ts: `process` along every road, and every other object along the roads
// on which the compiler does not follow it. What came back has the members it has in plain Bun.
import { family } from "../family";
import {
  generate,
  isUnseen,
  listings,
  nameOf,
  roads,
  subjects,
} from "../objects-listed-after-a-built-in-hands-them-back";

export default family(
  "an object that a built-in hands back has the members it has in plain Bun",
  subjects.flatMap((subject, subjectIndex) =>
    roads.flatMap((road, roadIndex) => {
      if (subjectIndex > 0 && !isUnseen(road)) return [];
      const [label, listing] = listings[(roadIndex + subjectIndex) % listings.length];
      return {
        name: nameOf(subject, road, label),
        make: () => ({ file: "main.mjs", text: generate(subject, road, listing), files: subject.files }),
      };
    }),
  ),
);
