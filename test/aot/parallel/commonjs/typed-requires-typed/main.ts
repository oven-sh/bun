// A typed file reaches another typed file by require(): once looked at as the module's own type, once as it comes.
import { Owner, type Root } from "./state";
function lazily(): typeof import("./state") { return require("./state.ts") as typeof import("./state"); }
function loosely(): any { return require("./state.ts"); }
let sum = 0;
for (let i = 0; i < 1000; i++) sum += lazily().currentRoot().id.length + lazily().currentRoot().owner.use() + (lazily().topOf(lazily().currentRoot()) ?? "").length;
console.log(sum, lazily().describe(lazily().currentRoot()));
const second: Root = { owner: new Owner(), id: "r2", place: null, notes: ["n"] };
lazily().setRoot(second);
console.log(lazily().describe(lazily().currentRoot()), lazily().currentRoot() === second);
loosely().setRoot({ owner: new Owner(), id: "r3", place: { start: "/c", top: "/c/d" }, notes: [] });
console.log(loosely().describe(loosely().currentRoot()), lazily().topOf(lazily().currentRoot()));
const third = { notes: ["x", "y"], place: null, id: "r4", owner: new Owner(), more: 1 };
loosely().setRoot(third);
console.log(lazily().describe(lazily().currentRoot()), lazily().currentRoot() === (third as unknown), Object.keys(lazily().currentRoot()).join());
loosely().setRoot(JSON.parse('{"owner":{"name":"owner","uses":5},"id":"r5","place":{"start":"/e","top":"/e/f"},"notes":["j"]}'));
console.log(loosely().describe(loosely().currentRoot()));
