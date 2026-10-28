// import() runs a module, which requires a second one, which calls import() on the first. Both promises settle when the first module has run.
process.on("exit", () => console.log(globalThis.state));
import("./running.mjs").then(() => console.log("the first call has settled"));
