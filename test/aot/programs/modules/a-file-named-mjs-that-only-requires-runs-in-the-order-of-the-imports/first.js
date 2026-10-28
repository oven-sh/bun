import { on } from "./registry.js";
console.log("the first file runs");
on(value => console.log("handled", value));
