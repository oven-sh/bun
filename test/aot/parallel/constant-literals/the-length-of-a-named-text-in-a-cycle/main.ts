// The other file of the cycle asks for the length while the constant is in its dead zone.
import { fromOther } from "./other";
export const OWN = "the text of main";
export function ownLength() { return OWN.length; }
console.log(fromOther, ownLength());
