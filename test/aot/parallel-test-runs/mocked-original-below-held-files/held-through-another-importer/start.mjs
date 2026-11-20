import { click } from "./click.mjs";
import { access } from "./access.mjs";
import { api } from "./api.mjs";
const state = "start";
export function start() {
  return state + " " + click() + " " + access() + " " + api();
}
