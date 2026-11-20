import { w, word, again } from "./a.mjs";
import * as all from "./b.mjs";
export const view = () => [w, word, again, all.w, all.word, Object.keys(all).join("+")].join();
