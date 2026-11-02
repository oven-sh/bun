const say = (...v) => console.log(...v.map(x => typeof x === "function" ? "fn:" + x.name : typeof x === "symbol" ? String(x) : typeof x === "object" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import { A } from "./a.mjs"; import { B } from "./b.mjs"; function helper() {} class Box {} say(A, B, helper.name, Box.name);
/* Output:
["helper","Box","arrow","method","function helper()","class Box {}","Box","<anonymous>"] ["helper","Box","arrow","method","function helper()","class Box {}","Box"] helper Box
*/
