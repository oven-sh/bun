process.on("uncaughtException", error => console.log("uncaught", error.message));
setTimeout(async () => {
  console.log("later", globalThis.seen);
  for (let turn = 0; turn < 2; turn++) {
    try {
      console.log(await import("./graph.mjs"));
    } catch (error) {
      console.log("import", error.message);
    }
  }
  console.log(globalThis.seen);
});
if (globalThis.process) require("./graph.mjs");
console.log("main");
