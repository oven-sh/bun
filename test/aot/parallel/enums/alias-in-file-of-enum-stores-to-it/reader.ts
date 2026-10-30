import { Color } from "./color";
export function read() {
  return [Color.Red, Color.Green, Color.Blue, Color["Green"]].join();
}
