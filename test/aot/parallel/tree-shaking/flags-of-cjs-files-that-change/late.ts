import { LATE } from "./written.cjs";
export function late() {
  return LATE ? require("./behind-late").answer() : "not late";
}
