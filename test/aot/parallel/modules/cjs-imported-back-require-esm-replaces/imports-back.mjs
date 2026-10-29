import * as file from "./file.cjs";
console.log("imports-back", shown(file), shown(file.default));
globalThis.readInCycle = () => console.log("imports-back again", shown(file), shown(file.default));
