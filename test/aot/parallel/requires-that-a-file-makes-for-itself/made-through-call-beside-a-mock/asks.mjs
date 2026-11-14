import { first } from "./maker.mjs";
import { word } from "./other.mjs";
export const ask = () => first("./value.cjs") + " " + word;
