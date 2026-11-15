import * as main from "./main";
export function later() {
  try {
    return "return " + main.OWN;
  } catch (error) {
    return "return " + JSON.stringify((error as Error).name);
  }
}
