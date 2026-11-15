import { middle } from "./middle.mjs";
import { inner } from "./inner.mjs";
const label = "outer";
export const outer = () => label + " " + middle() + " " + inner();
