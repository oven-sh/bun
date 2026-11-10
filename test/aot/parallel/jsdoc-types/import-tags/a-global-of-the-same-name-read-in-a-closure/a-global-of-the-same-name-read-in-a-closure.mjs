/** @import { thing } from "./kinds.mjs" */
const read = () => () => thing;
globalThis.thing = "the global";
console.log(read()());
