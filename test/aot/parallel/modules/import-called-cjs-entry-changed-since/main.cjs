// The names that an import of this entry point finds are those that it had when its body ended, and the import() takes as many turns as one of a module that is loaded.
exports.first = 1;
Object.defineProperty(exports, "read", { enumerable: true, get: () => (console.log("the getter runs"), 4) });
console.log("main ends");
setTimeout(async () => {
  exports.late = 2;
  exports.first = 3;
  let ticks = 0;
  const tick = () => {
    console.log("tick", ++ticks);
    if (ticks < 12) Promise.resolve().then(tick);
  };
  Promise.resolve().then(tick);
  console.log("import() is called");
  const main = await import("./main.cjs");
  console.log(Object.keys(main).join(), main.first, main.default.first, main.late, main.read, main.default === exports);
  await import("./binds.mjs");
}, 1);
