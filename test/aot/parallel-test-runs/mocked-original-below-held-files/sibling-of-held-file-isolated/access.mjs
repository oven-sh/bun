import { api } from "./api.mjs";
const state = "access";
export function access() {
  return state + " " + api();
}
