import { word } from "./absent.mjs";
import * as all from "./absent.mjs";
console.log("SAID user runs");
export const user = () => [word, all.word, all.more, Object.keys(all).sort().join("+")].join();
