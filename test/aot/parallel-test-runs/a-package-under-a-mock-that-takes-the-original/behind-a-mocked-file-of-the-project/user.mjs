import "./before.mjs";
import { kept as ofPart } from "./part.mjs";
import { kept } from "pack";
import "./after.mjs";
globalThis.order = (globalThis.order ?? "") + "user ";
export const seen = ofPart + " " + kept;
