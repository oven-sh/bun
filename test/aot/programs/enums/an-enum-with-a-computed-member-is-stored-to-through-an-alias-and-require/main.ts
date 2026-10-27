import { spoil } from "./alias";
import { read } from "./reader";
console.log(read());
spoil();
console.log(read());
require("./color").Color.Red = 8;
console.log(read());
