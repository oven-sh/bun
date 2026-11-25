import { api } from "./api.mjs";
import { access } from "./access.mjs";
import { click } from "./click.mjs";
import { second } from "./second.mjs";
const state = "start";
export function start() {
  return state + " " + api() + " " + access() + " " + click() + " " + second();
}
