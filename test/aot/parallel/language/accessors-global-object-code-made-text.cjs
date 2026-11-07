// Code made from text at run time reads and stores a global that is an accessor, and a getter made from text is found by a free name. Sloppy code.
const seen = [];
function describe(value) {
  return value === globalThis ? "global" : value === undefined ? "undefined" : value === null ? "null" : typeof value;
}
function note(label, value) {
  seen.push(label + "=" + describe(value));
}
function flush(title) {
  console.log(title + ": " + seen.join(" "));
  seen.length = 0;
}

Object.defineProperty(globalThis, "accessor", {
  configurable: true,
  get: function () {
    return this;
  },
  set: function (value) {
    note("set", this);
  },
});
note("indirect eval", (0, eval)("accessor"));
note("Function", new Function("return accessor")());
note("direct eval", eval("accessor"));
flush("read from text");
(0, eval)("accessor = 1");
new Function("accessor = 1")();
eval("accessor = 1");
flush("stored from text");

Object.defineProperty(globalThis, "getterFromText", { configurable: true, get: new Function("return this") });
note("first", getterFromText);
note("second", getterFromText);
flush("getter made from text");
