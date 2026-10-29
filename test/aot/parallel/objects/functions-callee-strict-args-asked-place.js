// The functions under callee of strict arguments are asked in place.
"use strict";
// The function under get | set of `callee` of the arguments of strict code, and of `caller` | `arguments` of Function.prototype, is one function of the engine that throws a TypeError. Each question stands in place.
function byDescriptor() {
  const found = Object.getOwnPropertyDescriptor(arguments, "callee");
  console.log("descriptor: typeof get", typeof found.get);
  console.log("descriptor: typeof set", typeof found.set);
  console.log("descriptor: get is set", found.get === found.set);
  console.log("descriptor: get is undefined", found.get === undefined);
  console.log("descriptor: instanceof", found.get instanceof Function);
  console.log("descriptor: length", found.get.length);
  let called;
  try { found.get(); called = "returned"; } catch (error) { called = error.constructor.name; }
  console.log("descriptor: called", called);
  const holder = { held: found.get };
  console.log("descriptor: stored", typeof holder.held);
  console.log("descriptor: truthy", found.get ? "yes" : "no");
  console.log("descriptor: has value", "value" in found);
  console.log("descriptor: frozen", Object.isFrozen(found.get));
}
function byReflect() {
  const found = Reflect.getOwnPropertyDescriptor(arguments, "callee");
  console.log("reflect: typeof get", typeof found.get);
  let called;
  try { found.set(1); called = "returned"; } catch (error) { called = error.constructor.name; }
  console.log("reflect: called", called);
  console.log("reflect: truthy", found.set ? "yes" : "no");
}
function byAllDescriptors() {
  const found = Object.getOwnPropertyDescriptors(arguments).callee;
  console.log("all: typeof get", typeof found.get);
  let called;
  try { found.get.call(undefined); called = "returned"; } catch (error) { called = error.constructor.name; }
  console.log("all: called", called);
}
function byLookup() {
  const getter = arguments.__lookupGetter__("callee");
  console.log("lookup: typeof", typeof getter);
  let called;
  try { getter(); called = "returned"; } catch (error) { called = error.constructor.name; }
  console.log("lookup: called", called);
}
function sameEverywhere() {
  const mine = Object.getOwnPropertyDescriptor(arguments, "callee").get;
  const ofCaller = Object.getOwnPropertyDescriptor(Function.prototype, "caller").get;
  const ofArguments = Object.getOwnPropertyDescriptor(Function.prototype, "arguments").set;
  console.log("same: caller", typeof ofCaller, mine === ofCaller);
  console.log("same: arguments", typeof ofArguments, mine === ofArguments);
  const list = [mine, ofCaller, ofArguments];
  console.log("same: in a list", list.map(each => typeof each).join());
}
byDescriptor(1, 2);
byReflect(1, 2);
byAllDescriptors(1, 2);
byLookup(1, 2);
sameEverywhere(1, 2);
