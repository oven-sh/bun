import * as tax from "./tax";
export function read() { return tax.rate + " " + tax.fee + " " + (tax as any).same; }
