// asker.cjs runs because root.mjs imports it. While it runs it requires root.mjs, the root of the graph that is being loaded, and then beside.mjs, which root.mjs imports and which imports root.mjs back.
// The loader runs the body of root.mjs ahead of the body of beside.mjs, inside the second require. The smallest of the drawn graphs on which what stands in for the loader at run time gives another order.
// main.cjs writes the names and lays them on the global object: the file that requires is not the one that writes.
globalThis.said = [];
globalThis.names = { root: "./root.mjs", beside: "./beside.mjs" };
require("./root.mjs");
console.log(globalThis.said.join(" "));
