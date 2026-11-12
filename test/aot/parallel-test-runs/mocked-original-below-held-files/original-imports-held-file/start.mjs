import { api } from "./api.mjs";
import { access } from "./access.mjs";
const state = "start";
export function start() {
  return state + " " + api() + " " + access();
}
