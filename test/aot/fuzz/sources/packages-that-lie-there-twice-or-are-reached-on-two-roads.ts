// fuzz/packages-that-lie-there-twice-or-are-reached-on-two-roads.ts: a package lies in node_modules twice (two versions, two copies, a file for `import` and one for `require`) or once and is reached on two
// roads (by itself, by name and by path, under two subpaths, through "imports", through links to a store). The program takes it itself and through a package that depends on it, and asks both for their version, their
// counter, their class and the fields of their instances. TypeScript accepts every program, so every build succeeds, and the executable prints what plain Bun prints. Every third program is built with its types erased.
import { corners, generate } from "../packages-that-lie-there-twice-or-are-reached-on-two-roads";
import { Random } from "../random";
import { endless } from "../family";

export default endless("packages that lie there twice or are reached on two roads", index => {
  const corner = corners[index % corners.length];
  const isErased = index % 3 === 2;
  return {
    name: `seed ${index + 1}, ${corner}${isErased ? ", types erased" : ""}.`,
    ...(isErased && { flags: ["--aot-erase-types"] }),
    make: () => generate(new Random(index + 1), corner),
  };
});
