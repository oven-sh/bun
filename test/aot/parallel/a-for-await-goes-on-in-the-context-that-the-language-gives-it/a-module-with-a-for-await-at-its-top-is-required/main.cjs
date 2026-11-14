// A module that awaits at its top is required: the require is refused, and the module goes on by itself. Its for await goes on in what the generator's body has entered.
const { AsyncLocalStorage } = require("node:async_hooks");
globalThis.als = new AsyncLocalStorage(); globalThis.log = []; als.run("w", () => {});
als.enterWith("main");
let said;
try { const steps = require("./steps.mjs"); said = "required " + Object.keys(steps).join(); } catch (error) { said = "refused " + error.code; }
log.push(said, "main " + String(als.getStore()));
