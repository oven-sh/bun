import { level } from "./one.cjs";
import "./two.cjs";
import { level as later } from "./three.cjs";
import "./four.cjs";
import "./shared.cjs";
console.log("first", level, later);
