// Two roads to one module: string decoder. It prints what plain Bun prints.
import * as space from "node:string_decoder";
import whole from "node:string_decoder";
import { StringDecoder as named_StringDecoder } from "node:string_decoder";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const required = require("node:string_decoder");
const asked = process.getBuiltinModule("node:string_decoder");
function same(name, ...answers) { console.log(name + " " + answers.map(answer => (answer ? "T" : "F")).join("")); }
same("StringDecoder", named_StringDecoder === space.StringDecoder, named_StringDecoder === whole.StringDecoder, named_StringDecoder === required.StringDecoder, named_StringDecoder === asked.StringDecoder, space.StringDecoder === required.StringDecoder, whole.StringDecoder === required.StringDecoder, asked.StringDecoder === required.StringDecoder, whole.StringDecoder === space.StringDecoder);
