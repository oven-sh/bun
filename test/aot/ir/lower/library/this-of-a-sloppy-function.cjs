// RUN: link
// OPTIONS: builtin-modules
// CHECK: runtimefunction id=StdioGetLightStdioWriteStreams

// A sloppy function that is called without a receiver gets the global object as `this`, and with it what lies behind every global.

// FILE: main.cjs
const root = (function () {
  return this;
})();
root.process.stdout.write("hello\n");
