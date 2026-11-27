import { Color } from "./color";
export function read() {
  let text = "";
  for (let i = 0; i < 2; i++) text += Color.Red + ",";
  return text + Color.Blue;
}
