// `arguments` and `caller` of a compiled sloppy function read as null even while it runs, and a store to either is ignored. A function with a "use strict" of its own is as sloppy as its file, as in plain Bun. Every other kind of function throws a TypeError, as in plain Bun. Constant text given to `new Function` is compiled with the program, so `arguments` of that function is null too.
function report(name, run) {
  let answer;
  try {
    answer = run();
  } catch (error) {
    answer = error.constructor.name;
  }
  console.log(name + ": " + answer);
}

function sloppy() {
  report("sloppy arguments === null", () => sloppy.arguments === null);
  report("sloppy caller === null", () => sloppy.caller === null);
  report("sloppy arguments after a store", () => {
    sloppy.arguments = 1;
    return sloppy.arguments;
  });
  report("sloppy caller after a store", () => {
    sloppy.caller = 1;
    return sloppy.caller;
  });
}
function callSloppy() {
  sloppy(1, 2);
}
callSloppy();

const restricted = {
  strict: function () {
    "use strict";
  },
  arrow: () => {},
  method: { method() {} }.method,
  class: class {},
  generator: function* () {},
  async: async function () {},
  "async generator": async function* () {},
};
for (const [kind, f] of Object.entries(restricted)) {
  report(kind + " arguments", () => f.arguments);
  report(kind + " caller", () => f.caller);
  report(kind + " arguments store", () => {
    f.arguments = 1;
    return "no error";
  });
  report(kind + " caller store", () => {
    f.caller = 1;
    return "no error";
  });
}

const countArguments = new Function("self", "return self.arguments.length;");
report("new Function arguments length", () => countArguments(countArguments, 1, 2));
const readCaller = new Function("self", "return self.caller;");
function callReadCaller() {
  return readCaller(readCaller);
}
report("new Function caller", callReadCaller);

module.exports = {};
