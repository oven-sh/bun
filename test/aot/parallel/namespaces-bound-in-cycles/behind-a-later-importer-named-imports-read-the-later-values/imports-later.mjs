import * as file from "./file.cjs";
import { first, count } from "./file.cjs";
console.log("imports-later:", Object.keys(file).join(" "), "| file.first", file.first, "| first", first, "| count", count);
