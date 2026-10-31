// A call of a name with a `--define` value calls the binding that the value names. A value of one name is called without a receiver. A value that is a path is called on the object that holds its last name.
// Flags: --define RUN=run --define DESCRIBE=holder.inner.describe --define MAKE=Kind --define TAG=tag
"use strict";
function run() {
  return this === undefined ? "no receiver" : "a receiver";
}
const holder = {
  inner: {
    describe() {
      return this === holder.inner ? "the receiver is the holder" : "another receiver";
    },
  },
};
class Kind {
  kind = "made by the class of the file";
}
function tag(strings, value) {
  return this === undefined ? strings[0] + value : "a receiver";
}
function calls(run, holder) {
  return [RUN(), DESCRIBE()].join();
}
const inner = { describe: () => "the parameter" };
console.log(RUN(), (0, RUN)(), RUN?.(), DESCRIBE(), (0, DESCRIBE)(), DESCRIBE?.(), new MAKE().kind, TAG`tagged ${1}`);
console.log(calls(() => "the parameter", { inner }));
