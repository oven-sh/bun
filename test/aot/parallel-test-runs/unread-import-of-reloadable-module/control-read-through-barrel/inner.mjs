import { base } from "./base.mjs";
import { mark, bump } from "./barrel.mjs";
export const inner = () => {
  bump();
  return "inner " + base + " " + mark;
};
