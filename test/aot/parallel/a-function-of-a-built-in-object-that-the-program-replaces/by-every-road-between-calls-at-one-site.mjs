// Every road by which a program replaces JSON.stringify, between calls at one site.
const real = JSON.stringify;
const said = [];
function ask(value) { return JSON.stringify(value); }
const note = label => said.push(label + ":" + (() => { try { return ask("a"); } catch (e) { return e.constructor.name; } })());
note("first"); note("again");
JSON.stringify = v => "stored " + v; note("stored");
JSON.stringify = real; note("restored");
Object.defineProperty(JSON, "stringify", { value: v => "defined " + v, configurable: true, writable: true }); note("defined");
Reflect.set(JSON, "stringify", v => "reflected " + v); note("reflected");
delete JSON.stringify; note("deleted");
Object.defineProperty(JSON, "stringify", { get() { said.push("got"); return v => "getter " + v; }, configurable: true }); note("getter");
Object.defineProperty(JSON, "stringify", { value: real, configurable: true, writable: true }); note("real again");
console.log(said.join(" | "));
