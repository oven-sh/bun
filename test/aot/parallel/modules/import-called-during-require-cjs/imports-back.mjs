import * as file from "./file.cjs";
import whole, { first, read } from "./file.cjs";
console.log("imports-back", Object.keys(file).join(), first, read, Object.keys(whole).join());
globalThis.readInCycle = () => console.log("in the cycle", Object.keys(file).join(), file.first, first, read, Object.keys(whole).join());
