import { rate } from "./tax.json";
const read = () => [rate].join();
console.log("SAID sale runs", read());
export const sold = read;
