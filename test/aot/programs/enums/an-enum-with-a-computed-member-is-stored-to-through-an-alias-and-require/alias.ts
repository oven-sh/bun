import * as colors from "./color";
import Alias = colors.Color;
export function spoil() {
  (Alias as any).Green = 9;
}
