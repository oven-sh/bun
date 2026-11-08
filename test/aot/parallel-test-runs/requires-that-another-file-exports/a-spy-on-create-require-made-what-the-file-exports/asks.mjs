import { load } from "./maker.mjs";
import { word } from "./other.mjs";
export const ask = () => [load("./value.cjs"), word].join(" ");
