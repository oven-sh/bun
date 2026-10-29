// Fixed seeds of fuzz/names-of-the-program-itself-read-by-the-files-that-it-loads.ts: the first file of the program exports a name and loads another file, by `import`, `require` or `import()`, and the last file of that
// road takes the name of the first file again and reads it while it loads, in a job, in a timer or when the first file calls.
// TypeScript accepts every program, so every build succeeds, and the executable prints what plain Bun prints and ends as it ends. Every third program is built with its types erased.
import { corners, generate } from "../names-of-the-program-itself-read-by-the-files-that-it-loads";
import { Random } from "../random";
import { family } from "../family";

export default family(
  "names of the program itself read by the files that it loads",
  Array.from({ length: corners.length * 20 }, (_, index) => {
    const corner = corners[index % corners.length];
    // The corners are a multiple of three, so the turn moves on by one with every row of them.
    const isErased = (index + Math.floor(index / corners.length)) % 3 === 2;
    return {
      name: `seed ${index + 1}, ${corner}${isErased ? ", types erased" : ""}.`,
      ...(isErased && { flags: ["--aot-erase-types"] }),
      make: () => generate(new Random(index + 1), corner),
    };
  }),
);
