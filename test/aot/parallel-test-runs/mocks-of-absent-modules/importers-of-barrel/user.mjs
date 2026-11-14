import { all, more, word } from "./barrel.mjs";
import * as whole from "./barrel.mjs";
export const user = () => [word, all.word, more, whole.word, whole.all.more, Object.keys(whole).sort().join("+")].join();
