import { rate } from "./tax";
import { fee } from "./fee";
import { pace } from "./slow";
console.log("reader runs");
export const read = [rate, fee, pace].join(", ");
