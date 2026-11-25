import { inner } from "./inner.mjs";
const label = "shared";
export const shared = () => label + " " + inner();
