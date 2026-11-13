import { platform } from "node:os";
console.log("SAID low runs");
export const low = () => platform() === "patched";
