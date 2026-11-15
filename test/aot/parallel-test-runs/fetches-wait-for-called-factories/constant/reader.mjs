import { last } from "./last.mjs";
const read = last();
export const reader = () => read;
console.log("SAID reader ran", read);
