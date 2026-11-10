import "./before.mjs";
import { kept } from "pack";
import "./after.mjs";
globalThis.order = (globalThis.order ?? "") + "user ";
export const seen = kept;
