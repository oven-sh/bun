import { load } from "./maker.js";
export const again = () => {
  const first = load("./value.cjs").run;
  for (const key of Object.keys(load.cache)) if (key.endsWith("value.cjs")) delete load.cache[key];
  return first + " " + load("./value.cjs").run;
};
