import * as tax from "./tax.json";
const kept = tax.rate;
console.log("sale runs", kept);
export const sold = () => [tax.rate, kept, tax.fee?.()].join();
