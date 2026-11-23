import { state } from "./state";
import { read } from "./config";
export function format() {
  return state.override ?? read();
}
