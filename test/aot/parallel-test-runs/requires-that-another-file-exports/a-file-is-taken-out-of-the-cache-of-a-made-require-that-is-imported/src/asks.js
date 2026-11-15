import { load } from "./maker.js";
export const again = () => {
  const first = load("./value.cjs").run;
  delete load.cache[load.resolve("./value.cjs")];
  return first + " " + load("./value.cjs").run;
};
