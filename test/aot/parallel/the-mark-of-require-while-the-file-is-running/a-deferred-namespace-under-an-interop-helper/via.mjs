import defer * as held from "./lib.mjs";
const interop = m => (m && m.__esModule ? m : { default: m });
console.log("SAID interop", typeof interop(held).default, interop(held) === held);
