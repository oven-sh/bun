// A call of import.meta.resolve that is written in a function, with a name made at run time, answers as the function taken off import.meta answers: before and after that function is first read, in a module and in a CommonJS file.
// COUNT: operation:operationAOTResolveDynamic >= 9
import { askBelow, takeBelow } from "./lib/below.mjs";
import commonjs from "./lib/asks.cjs";

const ask = name => import.meta.resolve(name);
const made = (...parts) => parts.join(".");
const attempt = f => { try { return f(); } catch (e) { return e.constructor.name; } };

const first = ask(made("./lib/below", "mjs"));
const { resolve } = import.meta;
console.log("own", first.endsWith("/lib/below.mjs"), attempt(() => resolve(made("./lib/below", "mjs")) === first), ask(made("./lib/below", "mjs")) === first);
console.log("below", askBelow(made("./below", "mjs")) === first, attempt(() => takeBelow()(made("./below", "mjs")) === first), askBelow(made("./below", "mjs")) === first);
console.log("commonjs", commonjs.ask(made("./below", "mjs")) === first, attempt(() => commonjs.take()(made("./below", "mjs")) === first), commonjs.ask(made("./below", "mjs")) === first);
console.log("thrown", attempt(() => ask({ toString() { throw new RangeError("no name"); } })), attempt(() => ask(made("@made-up/nothing", "js"))), attempt(() => commonjs.ask(made("@made-up/nothing", "js"))));
