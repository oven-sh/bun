import { inner } from "./inner.mjs";
const label = "above";
export const above = () => label + " " + inner();
