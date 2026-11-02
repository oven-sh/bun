const say = (...v) => console.log(...v.map(x => typeof x === "function" ? "fn:" + x.name : typeof x === "symbol" ? String(x) : typeof x === "object" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; const t = f => { try { return f(); } catch (e) { return e.message; } }; (async () => { say(t(() => require("./bad.cjs")), t(() => require("./bad.cjs")), globalThis.runs, await import("./bad.mjs").catch(e => e.message), await import("./bad.mjs").catch(e => e.message), globalThis.eruns); })();
/* Output:
run 1 run 1 1 esm run 1 esm run 1 1
*/
