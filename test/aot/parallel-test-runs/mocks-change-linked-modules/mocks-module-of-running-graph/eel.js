import * as all_fox from "./fox.js";
import { gnu } from "./gnu.js";
const state_eel = "eel ";
export function eel() { return "(" + state_eel + all_fox.fox() + gnu() + ")"; }
