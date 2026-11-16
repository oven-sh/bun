// RUN: link
// OPTIONS: builtin-modules
// CHECK: runtimefunction id=StdioGetLightStdioWriteStreams

// The program sets what stands above `process`. From then on a name that `process` does not have finds a getter of the program, which gets
// `process` as `this`: whoever reads `all` has the object, and with it what lies behind every member of it.

// FILE: main.js
process.__proto__ = {
  get all() {
    return this;
  },
};
process.all["std" + "out"].write("hello\n");
