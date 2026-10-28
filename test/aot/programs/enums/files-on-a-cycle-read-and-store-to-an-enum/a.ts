import { Color } from "./color";
import { b } from "./b";
export function a() {
  return Color.Green;
}
(Color as any).Green = 9;
console.log("a", b());
