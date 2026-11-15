import { word } from "./part.mjs";
export const read = () => word;
export const later = () => import("./part.mjs").then(whole => whole.word);
