"use strict";
// A direct eval in strict code. The file is strict as a whole: `bun run` drops a "use strict" that only a function has.
module.exports = {};

function show(label, run) {
  try {
    console.log(label, run());
  } catch (error) {
    console.log(label, "throws", error.name);
  }
}

function declares() {
  eval("var z = 1");
  return typeof z;
}
show("eval keeps its variable", declares);
show("nothing on the global object", () => typeof globalThis.z);

const named = function self() {
  eval("self = 1");
  return typeof self;
};
show("function name", named);
