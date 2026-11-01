const say = (...v) => console.log(...v.map(x => typeof x === "function" ? "fn:" + x.name : typeof x === "symbol" ? String(x) : typeof x === "object" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; say(require("./lib.cjs").m, require.main === module, module.loaded, Object.keys(require.cache).length > 0, typeof require.resolve("./lib.cjs"));
/* Output:
string string true true true object function true false function object exports,require true true false string
*/
