import { Color } from "./color";
import { read } from "./reader";
console.log(read(), typeof Color, Color === Color, Color ? "there" : "gone", Color instanceof Object, `${Color}`);
