import { rate, fee, box } from "./tax.mjs";
export const sold = () => rate + " " + fee() + " " + ++box.n;
