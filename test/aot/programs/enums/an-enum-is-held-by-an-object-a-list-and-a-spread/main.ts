import { Color } from "./color";
import { read } from "./reader";
const holder = { Color };
(holder.Color as any).Green = 9;
console.log(read(), { ...Color }.Green);
const [first] = [Color];
(first as any).Red = 8;
console.log(read());
