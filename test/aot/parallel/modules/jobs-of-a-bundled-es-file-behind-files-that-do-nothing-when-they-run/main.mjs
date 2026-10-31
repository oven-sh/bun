// A file that leaves nothing to run is no step of the evaluation, and an imported CommonJS file runs while the graph is loaded: behind any number of them the bundle is still the first ES file to run.
import "./without-code.mjs";
import { constant } from "./one-constant.mjs";
import { declared } from "./declarations.mjs";
import { Plain } from "./a-class.mjs";
import data from "./data.json";
import { quiet } from "./quiet.cjs";
import { quietToo } from "./quiet-too.cjs";
import { x } from "./barrel.mjs";
import { behind } from "./quiet-behind.cjs";
console.log("body: main", x, constant, declared(), new Plain().m(), data.data, quiet, quietToo, behind);
