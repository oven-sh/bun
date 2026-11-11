import { barrel } from "./barrel.mjs";
import { leaf } from "./leaf.mjs";
export const entry = () => barrel() + " " + leaf();
