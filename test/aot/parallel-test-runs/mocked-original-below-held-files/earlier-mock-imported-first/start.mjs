import { routes } from "./routes.mjs";
import { api } from "./api.mjs";
import { click } from "./click.mjs";
import { access } from "./access.mjs";
const state = "start";
export function start() {
  return state + " " + routes() + " " + api() + " " + click() + " " + access();
}
