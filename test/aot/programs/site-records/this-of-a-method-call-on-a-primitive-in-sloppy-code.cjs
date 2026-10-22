// In sloppy code a method that is called on a primitive value sees a wrapper object as `this`, and a function called by value sees the global object. In strict functions of the same file `this` is the value itself.
function kindOfThis() {
  return typeof this + " " + (this === globalThis ? "global" : Object.prototype.toString.call(this));
}
function strictKindOfThis() {
  "use strict";
  return typeof this + " " + String(typeof this === "symbol" ? "symbol" : this);
}
function Holder() {
  this.sloppy = kindOfThis;
  this.strict = strictKindOfThis;
}

function attempt(run) {
  try {
    return String(run());
  } catch (error) {
    return "throws " + error.constructor.name;
  }
}
function callSloppy(holder) {
  return holder.sloppy();
}
function callStrict(holder) {
  return holder.strict();
}
function callByValue(callee) {
  return callee();
}
function look(mark, holder) {
  console.log(mark + ":", attempt(() => callSloppy(holder)), "|", attempt(() => callStrict(holder)));
}

// String.prototype takes new names under --aot too.
String.prototype.sloppy = kindOfThis;
String.prototype.strict = strictKindOfThis;

look("holder", new Holder());
look("literal", { sloppy: kindOfThis, strict: strictKindOfThis });
look("text", "text");
look("empty text", "");
look("joined text", ["a", "b"].join("-") + "c".repeat(30));
look("holder", new Holder());
look("string object", new String("boxed"));
look("text", "text");
look("number", 5);
look("null", null);
look("undefined", undefined);
console.log(callByValue(kindOfThis), "|", callByValue(strictKindOfThis), "|", callByValue(new Holder().sloppy), "|", callByValue(new Holder().strict), "|", callByValue("text".sloppy), "|", callByValue("text".strict));
console.log(kindOfThis.call(5), "|", strictKindOfThis.call(5), "|", kindOfThis.call(null), "|", strictKindOfThis.call(null), "|", kindOfThis.apply(undefined), "|", kindOfThis.call("text"), "|", kindOfThis.call(true), "|", kindOfThis.call(5n), "|", kindOfThis.call(Symbol("s")));
delete String.prototype.sloppy;
delete String.prototype.strict;
look("text, after the names are gone", "text");
