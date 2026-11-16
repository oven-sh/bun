import { rate, fee } from "./tax.cjs";
const kept = rate;
console.log("SAID sale runs");
export const sold = () => [rate, fee(), kept].join();
