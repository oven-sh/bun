// Callee of strict arguments is read stored deleted and walked over.
"use strict";
// `callee` of the arguments of strict code is an accessor that throws: a read, a store and a deletion throw a TypeError, a walk over enumerable properties passes it by. Each question stands in place.
function readByName() {
  let said;
  try { const got = arguments.callee; said = "returned " + typeof got; } catch (error) { said = error.constructor.name; }
  console.log("read by name", said);
}
function readAndDropped() {
  let said = "returned";
  try { arguments.callee; } catch (error) { said = error.constructor.name; }
  console.log("read and dropped", said);
}
function storeByName() {
  let said = "returned";
  try { arguments.callee = 1; } catch (error) { said = error.constructor.name; }
  console.log("store by name", said);
}
function readByKey(key) {
  let said;
  try { const got = arguments[key]; said = "returned " + typeof got; } catch (error) { said = error.constructor.name; }
  console.log("read by key", said);
}
function storeByKey(key) {
  let said = "returned";
  try { arguments[key] = 1; } catch (error) { said = error.constructor.name; }
  console.log("store by key", said);
}
function asked() {
  console.log("has own", Object.hasOwn(arguments, "callee"), "callee" in arguments);
  console.log("names", Object.getOwnPropertyNames(arguments).join());
  console.log("keys", Object.keys(arguments).join());
  let said = "returned";
  try { Object.assign({}, arguments); } catch (error) { said = error.constructor.name; }
  console.log("assign", said);
  said = "returned";
  try { Reflect.get(arguments, "callee"); } catch (error) { said = error.constructor.name; }
  console.log("reflect get", said);
  said = "returned";
  try { const { callee } = arguments; said = "returned " + typeof callee; } catch (error) { said = error.constructor.name; }
  console.log("destructured", said);
  console.log("deleted", delete arguments.callee === false ? "refused" : "gone");
}
function deleted() {
  let said;
  try { said = "returned " + delete arguments.callee; } catch (error) { said = error.constructor.name; }
  console.log("delete", said);
}
const name = ["cal", "lee"].join("");
readByName(1); readAndDropped(1); storeByName(1); readByKey(name); storeByKey(name); deleted(1);
try { asked(1, 2); } catch (error) { console.log("asked threw", error.constructor.name); }
