// RUN: link
// OPTIONS: builtin-modules
// CHECK: = RequireDynamic
// CHECK: runtimefunction id=CommonJSOverridableRequire

// The build reads the name and finds no file under it. Where the call runs, the text goes to the loader of the host, which words the error.

// FILE: main.cjs
try {
  require(__filename.replace("main.cjs", "none.cjs"));
} catch (error) {
  console.log(error.code);
}
