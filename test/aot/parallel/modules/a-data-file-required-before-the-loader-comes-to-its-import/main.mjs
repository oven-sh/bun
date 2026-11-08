// The loader takes what main.mjs imports level by level, and a CommonJS file runs where the loader comes to it. What stands six levels down is not loaded by then:
// require() parses the file itself and answers the value, not the namespace object of an ES module. That answer stays, for every file that requires it later.
import { again } from "./early.cjs";
import "./level-1.mjs";
again();
