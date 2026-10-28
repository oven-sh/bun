import { __require } from "./chunk.mjs";
try {
  console.log(__require("./inside.cjs"));
} catch (error) {
  console.log(error.constructor.name);
}
export const later = () => __require("./inside.cjs");
