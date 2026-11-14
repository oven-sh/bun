import { rate, fee } from "./barrel.mjs";
const kept = rate;
console.log("SAID sale runs", kept);
export const sold = () => [rate, kept, fee?.()].join();
