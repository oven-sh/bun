import { inner } from "./helper.js";
import { deepest } from "middle";
console.log("index runs");
export const seen = () => inner() + " " + deepest();
