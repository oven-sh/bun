import * as maker from "./maker.js";
export const again = () => {
  const first = maker.load("./value.cjs").run;
  delete maker.load.cache[maker.load.resolve("./value.cjs")];
  return first + " " + maker.load("./value.cjs").run;
};
