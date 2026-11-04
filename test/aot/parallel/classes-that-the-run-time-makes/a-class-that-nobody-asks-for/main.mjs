import "./unused.mjs";
import { used } from "./used-by-construction-alone.mjs";
console.log(used().m(), used().constructor.name);
