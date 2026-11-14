import { inner } from "./inner.mjs";
const label = "middle";
export const middle = () => label + " " + inner();
