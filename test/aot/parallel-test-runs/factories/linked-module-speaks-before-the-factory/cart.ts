import { currency, rate } from "./tax";

console.log("cart");
export const total = (net: number) => net * rate + " " + currency;
