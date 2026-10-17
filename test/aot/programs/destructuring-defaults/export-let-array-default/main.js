// An exported `let` holding a function is reassigned by an array destructuring pattern with a default, and read from another module.
const show = (x) => typeof x === "function" ? "function" : String(x);
const attempt = (g) => { try { return show(g()); } catch (e) { return "threw " + e.name; } };
const two = () => "two";
import { f, first, write, call } from "./lib.js";
import * as ns from "./lib.js";
for (const V of [two, 7, "text", undefined, null, new Proxy(two, {}), class K {}]) { write(V); console.log([attempt(() => f()), attempt(() => call()), attempt(() => ns.f()), f === first, typeof f].join(" | ")); }
