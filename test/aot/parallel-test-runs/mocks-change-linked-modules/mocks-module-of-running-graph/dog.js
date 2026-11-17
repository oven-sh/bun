import { fox } from "./fox.js";
import { eel } from "./eel.js";
const state_dog = "dog ";
export function dog() { return "(" + state_dog + fox() + eel() + ")"; }
