import file, { second } from "./file.cjs";
import * as all from "./file.cjs";
export const own = "of main";
console.log("main", file.first, second, Object.keys(all).join());
