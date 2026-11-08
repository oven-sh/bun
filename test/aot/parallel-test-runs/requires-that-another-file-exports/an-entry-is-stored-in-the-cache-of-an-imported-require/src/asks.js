import { load } from "./maker.js";
export const again = () => {
  const first = load("./value.cjs").run;
  load.cache[load.resolve("./value.cjs")] = { exports: { run: "stored" }, loaded: true };
  return first + " " + load("./value.cjs").run;
};
