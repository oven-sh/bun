import { middle } from "./middle.mjs";
import { shared } from "./shared.mjs";
const label = "outer";
export const outer = () => label + " " + middle() + " " + shared();
