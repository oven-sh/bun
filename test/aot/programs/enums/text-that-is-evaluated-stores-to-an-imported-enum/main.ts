import { Color } from "./color";
import { read } from "./reader";
console.log(read(), Color.Green);
eval("Color.Green = 9");
console.log(read(), Color.Green);
