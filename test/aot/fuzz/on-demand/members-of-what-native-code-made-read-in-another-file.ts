// Fixed seeds of fuzz/members-of-what-native-code-made-read-in-another-file.ts: native code makes an object (an event, an error, what a regular expression finds, a descriptor, a step of an iterator, a response, a parsed
// path ..), and a function in the same file or in another one reads members of it that the program never stored, alone or beside an object of the program that has a member of that name.
// TypeScript accepts every program, so every build succeeds, and the executable prints what plain Bun prints and ends as it ends. Every third program is built with its types erased.
import { corners, generate } from "../../fuzz/members-of-what-native-code-made-read-in-another-file";
import { Random } from "../../fuzz/random";
import { generated } from "../../generated/run-generated";

/** A member that the constructor of events makes on each event, read off a copy of the event. */
const onceWrong = [160];

generated(
  "members of what native code made read in another file",
  Array.from({ length: corners.length * 8 }, (_, index) => {
    const corner = corners[index % corners.length];
    const isErased = (index + Math.floor(index / corners.length)) % 3 === 2;
    return {
      name: `seed ${index + 1}, ${corner}${isErased ? ", types erased" : ""}.`,
      // Every run takes one seed of each corner; AOT_GENERATED=all takes all.
      isAlwaysRun: index < corners.length,
      isOnlyCompiled: true as const,
      keepsItsText: true as const,
      exitsAsPlainBunDoes: true as const,
      ...(isErased && { flags: ["--aot-erase-types"] }),
      ...(onceWrong.includes(index + 1) && { wasOnceWrong: true }),
      make: () => generate(new Random(index + 1), corner),
    };
  }),
);
