import tax from "./tax.json";
const read = () => [tax?.rate, tax?.fee, tax?.more].join();
console.log("SAID sale runs", read());
export const sold = read;
