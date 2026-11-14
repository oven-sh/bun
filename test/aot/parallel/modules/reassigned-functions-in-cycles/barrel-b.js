import { h, setH } from "./barrel-a.js";
console.log("barrel b", h());
setH(() => "replaced");
