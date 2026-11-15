import * as tax from "./tax.json";
const kept = tax.rate ?? tax.default?.rate;
console.log("SAID sale runs", kept);
export const sold = () => [tax.rate ?? tax.default?.rate, kept, tax.fee?.()].join();
