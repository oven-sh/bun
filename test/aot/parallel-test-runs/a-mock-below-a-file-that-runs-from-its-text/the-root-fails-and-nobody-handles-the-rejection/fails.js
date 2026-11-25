import "./served.js"; import { x } from "./k.js"; globalThis.reached.resolve(); throw new Error("the body of fails.js threw " + x);
