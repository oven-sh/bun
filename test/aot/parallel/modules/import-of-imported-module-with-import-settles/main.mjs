// import() runs a module that imports another one. It requires a third module, which calls import() on the first again. Both promises are fulfilled when the first module has run.
import("./running.mjs").then(
  names => console.log("first import of running: fulfilled, ended:", names.ended),
  error => console.log("first import of running: rejected,", error.message),
);
console.log("main ends");
export {};
