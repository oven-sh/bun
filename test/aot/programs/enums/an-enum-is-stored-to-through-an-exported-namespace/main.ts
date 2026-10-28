import { colors } from "./barrel";
import { read } from "./reader";
(colors.Color as any).Green = 9;
console.log(read());
