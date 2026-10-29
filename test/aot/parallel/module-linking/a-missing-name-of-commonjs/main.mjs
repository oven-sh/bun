const say = (...v) => console.log(...v.map(x => typeof x === "function" ? "fn:" + x.name : typeof x === "symbol" ? String(x) : typeof x === "object" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import { nope, a } from "./lib.cjs"; say(typeof nope, a);
/* Output:
exit code 1
SyntaxError: Export named 'nope' not found in module '/$bunfs/root/module-linking/a-missing-name-of-commonjs/lib.cjs'.
*/
