import { seenAtLoad, counterAtLoad, bump } from "./lib.mjs";
bump(); bump();
globalThis.mode = "changed later";
console.log(seenAtLoad, counterAtLoad);
