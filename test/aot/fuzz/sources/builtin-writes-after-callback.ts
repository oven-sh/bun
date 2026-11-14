// A list of programs from ../generators/builtin-writes-after-callback.ts, which describes them.
import { cases, crowd, textInCrowd, textOf } from "../generators/builtin-writes-after-callback";
import { family } from "../family";

// On both sides of the compiler's limits on shapes per property name and shapes per type.
const sizesOfCrowds = [20, 70, 1100];

export default family("builtin writes after callback", [
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
