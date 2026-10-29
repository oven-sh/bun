// Fixed seeds of fuzz/members-of-library-objects-under-keys-that-are-values.ts: the program makes one object of a built-in module and goes through every key that it and the objects above it list, symbols too,
// with the key as a value; asked is the object, an heir, a proxy, `Reflect.get` with a receiver, an object that has the prototype and was never constructed, `super`, a getter, a setter or a function on another receiver.
// TypeScript accepts every program, so every build succeeds, and the executable prints what plain Bun prints and ends as it ends. Every third program is built with its types erased.
import { corners, generate } from "../members-of-library-objects-under-keys-that-are-values";
import { Random } from "../random";
import { family } from "../family";

/** Some of the functions that the program calls under keys out of a list are not in the executable. */
const lacksWhatIsCalled = [43, 44, 1598, 1724];

/** Built without --aot-validate today. */
const notValidatedToday = [537];

export default family(
  "members of library objects under keys that are values",
  corners.map((corner, index) => {
    const isErased = index % 3 === 2;
    return {
      name: `seed ${index + 1}, ${corner}${isErased ? ", types erased" : ""}.`,
      ...(isErased && { flags: ["--aot-erase-types"] }),
      ...(notValidatedToday.includes(index + 1) && {}),
      ...(lacksWhatIsCalled.includes(index + 1) && {
        linesDepartToday: "a function of the library that is called under a key out of a list is refused",
      }),
      make: () => generate(new Random(index + 1), corner),
    };
  }),
);
