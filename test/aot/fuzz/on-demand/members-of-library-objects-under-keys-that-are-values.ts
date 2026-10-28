// Fixed seeds of fuzz/members-of-library-objects-under-keys-that-are-values.ts: the program makes one object of a built-in module and goes through every key that it and the objects above it list, symbols too,
// with the key as a value; asked is the object, an heir, a proxy, `Reflect.get` with a receiver, an object that has the prototype and was never constructed, `super`, a getter, a setter or a function on another receiver.
// TypeScript accepts every program, so every build succeeds, and the executable prints what plain Bun prints and ends as it ends. Every third program is built with its types erased.
import { corners, generate } from "../../fuzz/members-of-library-objects-under-keys-that-are-values";
import { Random } from "../../fuzz/random";
import { generated } from "../../generated/run-generated";

const onceWrong = [1, 8, 15, 23, 36, 59, 499, 513, 585, 594, 887, 899, 1037, 1064, 1251, 1265];

/** Some of the functions that the program calls under keys out of a list are not in the executable. */
const lacksWhatIsCalled = [43, 44, 1598, 1724];

/** Built without --aot-validate today. */
const notValidatedToday = [537];

generated(
  "members of library objects under keys that are values",
  corners.map((corner, index) => {
    const isErased = index % 3 === 2;
    return {
      name: `seed ${index + 1}, ${corner}${isErased ? ", types erased" : ""}.`,
      // Every run takes one program in seventeen, so that each object and each receiver come up; AOT_GENERATED=all takes all.
      isAlwaysRun: index % 17 === 0,
      isOnlyCompiled: true as const,
      // Each program is built alone and as it is written: what it holds of the library is its own.
      keepsItsText: true as const,
      exitsAsPlainBunDoes: true as const,
      ...(isErased && { flags: ["--aot-erase-types"] }),
      ...(onceWrong.includes(index + 1) && { wasOnceWrong: true }),
      ...(notValidatedToday.includes(index + 1) && { isNeverValidated: true as const }),
      ...(lacksWhatIsCalled.includes(index + 1) && {
        linesDepartToday: "a function of the library that is called under a key out of a list is refused",
      }),
      make: () => generate(new Random(index + 1), corner),
    };
  }),
);
