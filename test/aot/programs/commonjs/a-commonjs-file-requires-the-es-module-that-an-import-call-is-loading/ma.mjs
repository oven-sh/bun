import x, { first } from "./mb.cjs";
export const early = typeof x + ":" + Object.keys(x).join() + ":" + first;
export const late = () => Object.keys(x).join() + ":" + first;
