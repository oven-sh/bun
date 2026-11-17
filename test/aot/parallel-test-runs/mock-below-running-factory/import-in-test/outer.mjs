import { middle } from "./middle.mjs";
const label = "outer";
export const outer = () => label + " " + middle();
