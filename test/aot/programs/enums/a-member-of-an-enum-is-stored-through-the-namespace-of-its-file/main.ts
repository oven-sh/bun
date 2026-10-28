import * as all from "./color";
import { Color } from "./color";
function spoil(o: any) {
  o.Color.Green = 3;
}
spoil(all);
console.log(Color.Green);
