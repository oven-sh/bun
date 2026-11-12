import { api } from "./api.mjs";
import { start } from "./start.mjs";
const state = "access";
export function access() {
  return state + " " + api() + " " + typeof start;
}
