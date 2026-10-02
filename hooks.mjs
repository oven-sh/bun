// Lets node run a bun:test file: maps `bun:test`, `bun:wrap` and `harness` onto the shims in this directory.
import { registerHooks } from "node:module";
const dir = new URL(".", import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "bun:test") return { url: new URL("bun-test.mjs", dir).href, shortCircuit: true };
    if (specifier === "bun:wrap") return { url: new URL("bun-wrap.mjs", dir).href, shortCircuit: true };
    if (specifier === "harness") return { url: new URL("harness.mjs", dir).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
