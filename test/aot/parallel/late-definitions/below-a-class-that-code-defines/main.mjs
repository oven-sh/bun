// The one store of the variable may never run. Then the variable holds nothing, and no object appears at its first read.
const say = run => { try { console.log(run()); } catch (e) { console.log(e.name + ": " + e.message); } };
import { read } from "./m.mjs";
console.log("main runs");
say(() => { const [A, B, C] = read(); return [new C().who(), Object.getPrototypeOf(C) === B, Object.getPrototypeOf(B) === A, C.x, read()[0] === A].join(); });
