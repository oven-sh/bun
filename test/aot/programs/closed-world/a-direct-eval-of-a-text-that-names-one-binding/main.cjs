"use strict";
// A direct eval whose text is known at the build and is nothing but the name of a binding reads that binding. A package that hides `require` from bundlers writes it so.
const inner = require("./inner.cjs");

function inquire(moduleName) {
  try {
    var mod = eval("quire".replace(/^/, "re"))(moduleName);
    if (mod && (mod.length || Object.keys(mod).length)) return mod;
  } catch (e) {}
  return null;
}
console.log("inquire:", typeof inquire("node:path").join, inquire("node:not-a-module"), eval("quire".replace(/^/, "re")) === require, eval("requir".replace(/$/, "e")) === require);

function kinds(parameter) {
  const constant = 1;
  let variable = 2;
  var old = 3;
  function declared() {
    return 4;
  }
  class Declared {}
  variable += 10;
  return [eval("parameter"), eval("constant"), eval("variable"), eval("old"), eval("declared")(), eval("Declared") === Declared, eval("kinds") === kinds, eval("inner") === inner].join();
}
console.log("kinds:", kinds(0));
console.log("of the module:", eval("module") === module, eval("exports") === exports, eval("__filename") === __filename, eval("__dirname") === __dirname);

function deadZone() {
  try {
    return eval("later");
  } catch (error) {
    return error.name;
  }
  let later = 1;
}
function shadowed(require) {
  return eval("require");
}
function innermost() {
  const name = "outer";
  {
    const name = "inner";
    return eval("name") + " " + (() => eval("name"))();
  }
}
function storedLater() {
  let value = "first";
  const read = () => eval("value");
  const before = read();
  value = "second";
  return before + " " + read();
}
console.log("dead zone:", deadZone(), "| shadowed:", shadowed("the parameter"), "| innermost:", innermost(), "| stored later:", storedLater());

function otherArguments() {
  const order = [];
  const value = "the value";
  const found = eval("value", order.push("second argument"));
  return found + " " + order.join();
}
console.log("other arguments:", otherArguments());

function anotherFunctionUnderTheName() {
  const value = "the binding";
  const original = globalThis.eval;
  globalThis.eval = text => "called with " + text;
  try {
    return eval("value");
  } finally {
    globalThis.eval = original;
  }
}
console.log("another function under the name:", anotherFunctionUnderTheName(), "| and back:", (value => eval("value"))("the binding"));
console.log("the files go on:", inner.twice(21));
