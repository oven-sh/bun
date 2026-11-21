// A require() with type text of code that a statement has loaded gets all exports of the code, and a require() without a type the same.
import { shade } from "./awning.mjs";
import { wood } from "./gate.cjs";
import asked from "./ask.cjs";
const gate = import.meta.require("./gate.cjs", { type: "text" });
console.log(shade, wood, asked.first, asked.second, asked.same, globalThis.raised);
console.log(typeof gate, Object.keys(gate).join(), gate.height);
