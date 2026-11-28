// A call of import.meta.resolve that is written in a function, with a name made at run time, calls what the program has stored under import.meta.resolve since.
import * as asks from "./lib/asks.mjs";

const name = ["./lib/asks", "mjs"].join(".");
const attempt = f => { try { return f(); } catch (e) { return e.constructor.name; } };
const last = text => String(text).split("/").at(-1);
const say = (what, f) => console.log(what, last(attempt(f)));

say("as built", () => asks.ask(name));
asks.replace();
say("replaced", () => asks.ask(name));
