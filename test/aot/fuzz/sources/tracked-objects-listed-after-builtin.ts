// A list of programs from ../tracked-objects-listed-after-builtin.ts, which describes them.
import { family } from "../family";
import {
  generate,
  isUnseen,
  listings,
  nameOf,
  roads,
  subjects,
} from "../tracked-objects-listed-after-builtin";

export default family(
  "tracked objects listed after builtin",
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
