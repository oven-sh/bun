// import() of a written path that is not there when the program is built. The options are read, and refused, before the module is looked for.
const ask = (what, promise) => promise.then(() => console.log(what, "loaded"), error => console.log(what, error.name, error.code));
await ask("attributes are a string", import("./absent.mjs", { with: "attributes" }));
await ask("options are a number", import("./absent.mjs", 5));
await ask("type is a number", import("./absent.mjs", { with: { type: 5 } }));
await ask("getter of with", import("./absent.mjs", { get with() { console.log("with is read"); return {}; } }));
await ask("getter of type", import("./absent.mjs", { with: { get type() { console.log("type is read"); return "json"; } } }));
await ask("getter throws", import("./absent.mjs", { get with() { throw new RangeError("thrown"); } }));
await ask("unknown type", import("./absent.mjs", { with: { type: "nonsense" } }));
await ask("type json", import("./absent.mjs", { with: { type: "json" } }));
await ask("empty options", import("./absent.mjs", {}));
await ask("undefined", import("./absent.mjs", undefined));
await ask("no options", import("./absent.mjs"));
