import { rate, fee } from "./tax";
import { pace } from "./slow";
console.log("reader runs");
export const read = [rate, fee, pace].join(", ");
