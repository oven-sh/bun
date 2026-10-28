// Two files of the cycle are imported from outside. The one that is named first decides which of them runs first.
import "./second.js";
import { a } from "./first.js";
console.log("main", a);
