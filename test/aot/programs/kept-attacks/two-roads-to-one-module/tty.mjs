// Two roads to one module, one probe of many. It prints what plain Bun prints.
import * as space from "node:tty";
import whole from "node:tty";
import { ReadStream as named_ReadStream, WriteStream as named_WriteStream, isatty as named_isatty } from "node:tty";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const required = require("node:tty");
const asked = process.getBuiltinModule("node:tty");
function same(name, ...answers) { console.log(name + " " + answers.map(answer => (answer ? "T" : "F")).join("")); }
same("ReadStream", named_ReadStream === space.ReadStream, named_ReadStream === whole.ReadStream, named_ReadStream === required.ReadStream, named_ReadStream === asked.ReadStream, space.ReadStream === required.ReadStream, whole.ReadStream === required.ReadStream, asked.ReadStream === required.ReadStream, whole.ReadStream === space.ReadStream);
same("WriteStream", named_WriteStream === space.WriteStream, named_WriteStream === whole.WriteStream, named_WriteStream === required.WriteStream, named_WriteStream === asked.WriteStream, space.WriteStream === required.WriteStream, whole.WriteStream === required.WriteStream, asked.WriteStream === required.WriteStream, whole.WriteStream === space.WriteStream);
same("isatty", named_isatty === space.isatty, named_isatty === whole.isatty, named_isatty === required.isatty, named_isatty === asked.isatty, space.isatty === required.isatty, whole.isatty === required.isatty, asked.isatty === required.isatty, whole.isatty === space.isatty);
