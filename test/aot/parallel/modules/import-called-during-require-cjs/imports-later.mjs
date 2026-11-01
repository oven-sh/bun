import * as file from "./file.cjs";
import whole, { count, first, read } from "./file.cjs";
console.log("imports-later", Object.keys(file).join(), file.first, first, read, count, Object.keys(whole).join());
