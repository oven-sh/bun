import { click } from "./click.mjs";
const state = "second";
export function second() {
  return state + " " + click();
}
