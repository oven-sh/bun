// Exports that nothing imports. Whether a call marked `/* @__PURE__ */` runs follows the bundler, also where its answer is an object that a weak reference observes.
// A call without the mark runs, and so does a marked one whose answer is imported.
// Reference: bun build --compile
import { made, weak, used } from "./shapes.mjs";
for (let i = 0; i < 4; i++) { await new Promise(done => setTimeout(done, 1)); Bun.gc(true); }
console.log(made.join(), weak.at(-1).deref() === used);
