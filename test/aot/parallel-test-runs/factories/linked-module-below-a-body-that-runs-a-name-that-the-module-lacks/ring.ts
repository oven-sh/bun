import "./helper";
import * as tax from "./tax";

console.log("ring");
export const name = "ring";
export const read = () => Object.keys(tax).join() + " " + tax.rate + " " + tax.above() + " " + (tax as any).more;
