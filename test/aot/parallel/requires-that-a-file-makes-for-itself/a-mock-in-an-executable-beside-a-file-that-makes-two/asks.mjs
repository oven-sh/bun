import { first, second } from "./maker.mjs";
import { word } from "./other.mjs";
export const ask = () => [first("./value.cjs"), second("./value.cjs"), word].join(" ");
