import "./eel.js";
import * as all_fox from "./fox.js";
import "./gnu.js";
const state_cat = "cat ";
export function cat() { return "(" + state_cat + all_fox.fox() + ")"; }
