import { Color } from "./color";
import { read } from "./reader";
console.log(read(), Object.keys(Color).join());
Object.assign(Color, { Green: 9 });
console.log(read());
Object.defineProperty(Color, "Red", { value: 8 });
console.log(read());
