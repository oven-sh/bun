// Fixed seeds of fuzz/members-of-what-crossed-a-border-under-typings-that-say-something-else.ts: an object crosses from a file of JavaScript into TypeScript under typings that are right about the object and, in one
// call, wrong about one member of it. Typed code does not use the member: it moves it into a fresh literal, a field, a list, a parameter, a closure, and keeps what it made, beside honest calls of the same function.
// Then what was kept is printed. TypeScript accepts every program, so every build succeeds, and the executable prints what plain Bun prints and ends as it ends. Every third program is built with its types erased.
import { corners, generate } from "../members-of-what-crossed-a-border-under-typings-that-say-something-else";
import { Random } from "../random";
import { family } from "../family";

export default family(
  "members of what crossed a border under typings that say something else",
  Array.from({ length: corners.length * 80 }, (_, index) => {
    const corner = corners[index % corners.length];
    // The corners are a multiple of three, so the turn moves on by one with every row of them.
    const isErased = (index + Math.floor(index / corners.length)) % 3 === 2;
    return {
      name: `seed ${index + 1}, ${corner}${isErased ? ", types erased" : ""}.`,
      ...(isErased && { flags: ["--aot-erase-types"] }),
      // The later half is drawn more densely, and half of its members lie one level further down.
      make: () => generate(new Random(index + 1), corner, index >= corners.length * 40),
    };
  }),
);
