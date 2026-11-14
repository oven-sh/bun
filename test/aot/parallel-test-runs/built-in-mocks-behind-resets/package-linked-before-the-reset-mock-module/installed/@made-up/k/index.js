import { platform } from "node:os";
console.log("k runs");
export const k = () => "k " + (platform() === process.platform ? "real" : platform());
