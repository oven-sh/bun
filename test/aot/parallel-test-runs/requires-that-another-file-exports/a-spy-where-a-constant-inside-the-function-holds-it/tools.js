import { createRequire } from "node:module";
export const load = createRequire(import.meta.url);
export const ask = () => {
  const mine = load;
  return mine("./value.cjs");
};
