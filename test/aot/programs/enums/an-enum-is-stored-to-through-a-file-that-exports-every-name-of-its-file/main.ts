import * as all from "./barrel";
import { read } from "./reader";
console.log(read());
(all.Color as any).Green = 9;
console.log(read());
