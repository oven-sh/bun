import { seen as below } from "./lamp.mjs";
import { shade } from "./shade.mjs";
globalThis.ran = (globalThis.ran ?? "") + "outer ";
export const seen = "outer " + below + " " + shade;
