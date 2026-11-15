import { routes } from "./routes.mjs";
const state = "above";
export function above() {
  return state + " " + routes();
}
