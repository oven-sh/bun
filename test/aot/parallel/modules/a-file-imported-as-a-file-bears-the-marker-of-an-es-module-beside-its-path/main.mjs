// A file imported as a file is a module with its path as the default export and the marker of an ES module beside it, however it is asked for.
import word, * as whole from "./pic.bin";
import * as note from "./note.txt" with { type: "file" };
const made = text => text.split("").join("");
const show = loaded => Object.keys(loaded).join() + " " + typeof loaded.default + " " + loaded.__esModule + " " + ("__esModule" in loaded);
console.log("by its ending:", show(whole), word === whole.default, JSON.stringify(Object.getOwnPropertyDescriptor(whole, "__esModule")));
console.log("by a written type:", show(note));
console.log("by a call:", show(await import("./carried.json", { with: { type: "file" } })));
const again = await import(made("./pic.bin"));
console.log("by its ending, under a name made at the run:", show(again), again === whole);
