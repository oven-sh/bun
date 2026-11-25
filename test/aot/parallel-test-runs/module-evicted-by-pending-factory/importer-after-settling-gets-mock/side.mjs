import { seen as below } from "./lamp.mjs";
globalThis.ran = (globalThis.ran ?? "") + "side ";
export const seen = "side " + below;
