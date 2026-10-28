import { Color } from "./color";
import { a } from "./a";
export function b() {
  return Color.Green + ":" + a();
}
console.log("b", a(), Color.Green);
