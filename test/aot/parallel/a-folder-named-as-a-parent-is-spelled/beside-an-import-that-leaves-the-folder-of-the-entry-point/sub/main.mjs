// In an executable a folder above that of the entry point is spelled `_.._`, in a mount beside the root. A real folder of that name beside the entry point is a folder like any other.
import { a } from "./_.._/a.mjs";
import { b } from "../a.mjs";
console.log(a, b);

