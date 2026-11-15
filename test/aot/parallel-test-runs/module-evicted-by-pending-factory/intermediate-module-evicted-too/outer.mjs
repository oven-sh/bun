import { seen as below } from "./lamp.mjs";
globalThis.ran = (globalThis.ran ?? "") + "outer ";
export const seen = "outer " + below;
