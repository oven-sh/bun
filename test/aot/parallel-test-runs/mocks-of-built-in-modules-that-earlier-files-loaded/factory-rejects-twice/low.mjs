import { platform } from "node:os";
console.log("SAID low runs");
let count = 0;
export const low = () => `${++count} ${platform() === "mock"}`;
