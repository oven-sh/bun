// A live binding through a re-export under another name.
import { w, bump } from "./b.mjs";
const before = w;
bump();
console.log(before, w);
