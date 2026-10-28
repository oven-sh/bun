import { read } from "./reader";
import.meta.require("./color.ts").Color.Green = 9;
console.log(read());
