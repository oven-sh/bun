import { cases, crowd, textInCrowd, textOf } from "./generated/built-ins-that-write-behind-a-callback";
import { generated } from "./generated/run-generated";

const alwaysRun =
  /^JSON\.parse|^a reviver answers (objects|arrays|a Map)|species constructor answers$|^Array\.(from|of) |^sort writes back|that detaches$|^Object\.assign stores what/;
// On either side of the limits on how many shapes with one name, and how many shapes in one type, the compiler lists.
const sizesOfCrowds = [20, 70, 1100];

generated("a built-in that writes behind a callback", [
  ...Object.keys(cases).map(name => ({
    name,
    isAlwaysRun: alwaysRun.test(name),
    isOnlyCompiled: true as const,
    make: () => ({ file: "main.js", text: textOf(name) }),
  })),
  ...sizesOfCrowds.flatMap(size =>
    Object.keys(cases).map((name, index) => ({
      name: `${name}, among ${size} shapes with the same names`,
      isAlwaysRun: index % 29 === size % 29,
      isOnlyCompiled: true as const,
      make: () => ({ file: "main.js", text: textInCrowd(name), files: { "crowd.js": crowd(size) } }),
    })),
  ),
]);
