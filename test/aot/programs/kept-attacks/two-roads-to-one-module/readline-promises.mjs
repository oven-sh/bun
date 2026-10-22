// Two roads to one module: readline promises. It prints what plain Bun prints.
import * as space from "node:readline/promises";
import whole from "node:readline/promises";
import { Interface as named_Interface, Readline as named_Readline, createInterface as named_createInterface } from "node:readline/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const required = require("node:readline/promises");
const asked = process.getBuiltinModule("node:readline/promises");
function same(name, ...answers) { console.log(name + " " + answers.map(answer => (answer ? "T" : "F")).join("")); }
same("Interface", named_Interface === space.Interface, named_Interface === whole.Interface, named_Interface === required.Interface, named_Interface === asked.Interface, space.Interface === required.Interface, whole.Interface === required.Interface, asked.Interface === required.Interface, whole.Interface === space.Interface);
same("Readline", named_Readline === space.Readline, named_Readline === whole.Readline, named_Readline === required.Readline, named_Readline === asked.Readline, space.Readline === required.Readline, whole.Readline === required.Readline, asked.Readline === required.Readline, whole.Readline === space.Readline);
same("createInterface", named_createInterface === space.createInterface, named_createInterface === whole.createInterface, named_createInterface === required.createInterface, named_createInterface === asked.createInterface, space.createInterface === required.createInterface, whole.createInterface === required.createInterface, asked.createInterface === required.createInterface, whole.createInterface === space.createInterface);
