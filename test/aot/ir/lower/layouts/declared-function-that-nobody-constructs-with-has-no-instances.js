// RUN: link
// CHECK: layout {{*}}kind=Instance name="Made"

// RUN(LEAVES): link
// LEAVES: layout {{*}}kind=Instance name="leaves"

// RUN(LINKED): link
// LINKED: layout {{*}}kind=Instance name="linked"

// RUN(CALLED): link
// CALLED-NOT: layout {{*}}kind=Instance name="method"
// CALLED-NOT: layout {{*}}kind=Instance name="listener"
// CALLED-NOT: layout {{*}}kind=Instance name="helper"
// CALLED-NOT: layout {{*}}kind=Instance name="called"
// CALLED-NOT: layout {{*}}kind=Instance name="getter"

// To store into `this` is no sign of a constructor: methods, accessors, listeners and helpers that are called with `call` do it as well. A declared function has a layout for what `new`
// makes of it only where the text of its file lets somebody construct with it: its name stands behind `new` or in front of `.prototype`, or goes where the file does not follow it.
// Whoever constructs with one of the others all the same gets an ordinary object.
function Made() {
  this.size = 1;
}

function linked() {
  this.size = 2;
}
linked.prototype.twice = function () {
  return this.size * 2;
};

function leaves() {
  this.size = 3;
}

function method() {
  this.size = 4;
}
Made.prototype.method = method;

function listener() {
  this.size = 5;
}

function helper() {
  this.size = 6;
}

function called() {
  this.size = 7;
}

function getter() {
  this.reads = 8;
  return 1;
}
Object.defineProperty(Made.prototype, "once", { get: getter });

export function run(emitter, receiver) {
  const made = new Made();
  emitter.on("change", listener);
  helper.call(made);
  made.method();
  receiver.called = 0;
  called();
  return [made, leaves];
}
