import { third } from "./third.mjs";
import { middle } from "./middle.mjs";
import { shared } from "./shared.mjs";
const label = "outer";
export const outer = () => label + " " + third() + " " + middle() + " " + shared();
