import { generated } from "./generated/run-generated";
import {
  builtIns,
  looks,
  textOf,
  textOfItself,
  textOfOne,
  values,
} from "./generated/values-looked-at-beside-built-in-objects";
import { buildFlags } from "./harness/flags";

const inEveryRun = ["WeakMap", "WeakRef", "Promise", "Map", "console", "Bun", "globalThis", "performance", "process", "Intl", "Error.prototype", "Array.prototype", "Function.prototype", "JSON.parse", "Array.prototype.push"]; // prettier-ignore

generated("a value of a known kind is looked at beside a built-in object", [
  ...builtIns.flatMap(builtIn =>
    Object.keys(looks).map(look => ({
      name: `${builtIn}, ${look}`,
      isAlwaysRun: inEveryRun.includes(builtIn) && look === "compared",
      isOnlyCompiled: true as const,
      make: () => ({ file: "main.mjs", text: textOf(builtIn, look) }),
    })),
  ),
  ...builtIns.map(builtIn => ({
    name: `${builtIn} itself, behind tests for classes`,
    isAlwaysRun: inEveryRun.includes(builtIn),
    isOnlyCompiled: true as const,
    make: () => ({ file: "main.mjs", text: textOfItself(builtIn) }),
  })),
  ...inEveryRun.flatMap(builtIn =>
    Object.keys(looks).flatMap(look =>
      Object.keys(values).map(value => ({
        name: `${builtIn}, ${look}, ${value} alone, every pass verified`,
        isAlwaysRun:
          look === "compared" && value === "a list" && ["WeakMap", "console", "Error.prototype"].includes(builtIn),
        isOnlyCompiled: true as const,
        flags: [buildFlags.verifyEachPass],
        make: () => ({ file: "main.mjs", text: textOfOne(builtIn, look, value) }),
      })),
    ),
  ),
]);
