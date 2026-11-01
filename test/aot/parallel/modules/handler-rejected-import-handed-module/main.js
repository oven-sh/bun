// The promise of import() is rejected with what the evaluation of the module throws: an error that native code makes, an error of the module's own, a primitive.
// The first handler is handed nothing else by anybody, so a compiler that takes its parameter for empty folds its tests away.
// Awaited: when a module has been loaded is the host's business, so beside the chain below its line came first or third.
await import("./alone.js").catch(error => {
  console.log("alone", typeof error !== "object" ? "no object: " + typeof error : "object " + error.name);
});
const describe = (title) => (error) => console.log(title, typeof error !== "object" ? "no object: " + typeof error : error === null ? "null" : "object " + error.name + " " + (error instanceof Error));
await import("./native.js").catch(describe("a native throws, catch"));
await import("./native.js").then(() => console.log("fulfilled"), describe("a native throws, then"));
await import("./own.js").catch(describe("the module throws an error of its own"));
await import("./primitive.js").catch(describe("the module throws a number"));
await import("./late.js").catch(describe("the module throws behind an await"));
await import("./through.js").catch(describe("a module that it imports throws"));
try { await import("./native.js"); } catch (error) { describe("awaited in try")(error); }
await Promise.all([import("./own.js")]).catch(describe("through Promise.all"));
await Promise.allSettled([import("./own.js")]).then(([settled]) => describe("through Promise.allSettled")(settled.reason));
await import("./own.js").finally(() => console.log("finally")).catch(describe("behind finally"));
