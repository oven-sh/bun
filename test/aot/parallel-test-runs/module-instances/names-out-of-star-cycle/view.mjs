import { word, own, more } from "./one.mjs";
import * as all from "./two.mjs";
export const view = () => [word, own, more, all.word, all.own, Object.keys(all).join("+")].join();
