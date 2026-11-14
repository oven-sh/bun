import { rate, fee } from "@made-up/tax";
const kept = rate;
console.log("SAID sale runs", kept);
export const sold = () => [rate, kept, fee?.()].join();
