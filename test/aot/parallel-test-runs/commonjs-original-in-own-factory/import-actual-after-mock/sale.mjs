import { rate, fee, box } from "./tax.cjs";
export const sold = () => rate + " " + fee() + " " + ++box.n;
