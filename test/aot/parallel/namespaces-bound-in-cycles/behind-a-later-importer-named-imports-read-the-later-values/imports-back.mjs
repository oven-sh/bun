import * as file from "./file.cjs";
import whole, { first } from "./file.cjs";
const bound = file;
globalThis.later = when => console.log(when + ":", Object.keys(file).join(" "), "| file.first", file.first, "| first", first, "| whole.first", whole.first, "| the object it was bound to:", file === bound);
globalThis.later("in the cycle");
