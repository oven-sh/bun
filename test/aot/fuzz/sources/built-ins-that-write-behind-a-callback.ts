import { cases, crowd, textInCrowd, textOf } from "../generators/built-ins-that-write-behind-a-callback";
import { family } from "../family";

// On either side of the limits on how many shapes with one name, and how many shapes in one type, the compiler lists.
const sizesOfCrowds = [20, 70, 1100];

export default family("a built-in that writes behind a callback", [
  ...Object.keys(cases).map(name => ({
    name,
    make: () => ({ file: "main.js", text: textOf(name) }),
  })),
  ...sizesOfCrowds.flatMap(size =>
    Object.keys(cases).map((name, index) => ({
      name: `${name}, among ${size} shapes with the same names`,
      make: () => ({ file: "main.js", text: textInCrowd(name), files: { "crowd.js": crowd(size) } }),
    })),
  ),
]);
