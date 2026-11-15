// The file that requires the path runs before the files that import it under a type, or behind them.
import { early as first } from "./first.mjs";
import text from "./data.json" with { type: "text" };
import { early as last } from "./last.mjs";
console.log(typeof text, first, last);
