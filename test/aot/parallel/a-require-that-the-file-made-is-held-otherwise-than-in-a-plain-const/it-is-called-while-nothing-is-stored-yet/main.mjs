import { createRequire } from "node:module";
let held;
const ask = () => {
  try {
    return held("./lib/part.cjs");
  } catch (error) {
    return error.name;
  }
};
const early = ask();
held = createRequire(import.meta.url);
const late = ask();
held = undefined;
console.log("SAID", early, late, ask());
