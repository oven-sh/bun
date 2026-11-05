// The text of a direct eval reads and stores the variables of its caller where they live.
module.exports = {};

let moduleCounter = 1;
const moduleConstant = 2;

function show(label, run) {
  try {
    console.log(label, run());
  } catch (error) {
    console.log(label, "throws", error.name);
  }
}

function storesParameter(a) {
  eval("a = a + 1");
  return a;
}
show("parameter", () => storesParameter(1));

function storesLet() {
  let value = 1;
  const add = () => eval("value += 1");
  add();
  value += 10;
  return [value, eval("value")];
}
show("let", storesLet);

function storesConst() {
  const value = 1;
  eval("value = 2");
  return value;
}
show("const", storesConst);

function readsDeadZone() {
  eval("early");
  let early = 1;
  return early;
}
show("read in dead zone", readsDeadZone);

function storesDeadZone() {
  eval("early = 2");
  let early = 1;
  return early;
}
show("store in dead zone", storesDeadZone);

const sloppyName = function self() {
  eval("self = 1");
  return typeof self;
};
show("function name", sloppyName);

function storesModuleVariable() {
  eval("moduleCounter = moduleCounter + 1");
  return moduleCounter;
}
show("module variable", storesModuleVariable);
show("module variable again", () => [eval("moduleCounter"), moduleCounter]);
show("module constant", () => eval("moduleConstant = 3"));

function readsArguments() {
  eval("arguments[0] = 9");
  return [eval("arguments.length"), arguments[0]];
}
show("arguments", () => readsArguments(1, 2));

const outsideObject = { outside: 1 };
let readsOutsideWith;
with (outsideObject) {
  readsOutsideWith = function () {
    return eval("outside = outside + 1");
  };
}
show("with outside the function", () => [readsOutsideWith(), outsideObject.outside]);

function storesInsideWith(object) {
  let value = 10;
  with (object) {
    eval("value = 20");
  }
  return [object.value, value];
}
show("with inside, name on the object", () => storesInsideWith({ value: 1 }));
show("with inside, name on the variable", () => storesInsideWith({}));

function readsUnbound() {
  return eval("nameNothingBinds");
}
show("unbound name", readsUnbound);
