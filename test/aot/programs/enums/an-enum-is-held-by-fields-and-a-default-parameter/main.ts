import { Color } from "./color";
import { read } from "./reader";
class Holder {
  static held = Color;
  own = Color;
}
function take(it: any = Color) {
  it.Green = 9;
}
console.log(read());
take();
console.log(read());
(Holder.held as any).Red = 8;
console.log(read());
(new Holder().own as any).Blue = 7;
console.log(read());
