// Two roads to one module, one probe of many. It prints what plain Bun prints.
import * as space from "node:querystring";
import whole from "node:querystring";
import { decode as named_decode, encode as named_encode, escape as named_escape, parse as named_parse, stringify as named_stringify, unescape as named_unescape, unescapeBuffer as named_unescapeBuffer } from "node:querystring";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const required = require("node:querystring");
const asked = process.getBuiltinModule("node:querystring");
function same(name, ...answers) { console.log(name + " " + answers.map(answer => (answer ? "T" : "F")).join("")); }
same("decode", named_decode === space.decode, named_decode === whole.decode, named_decode === required.decode, named_decode === asked.decode, space.decode === required.decode, whole.decode === required.decode, asked.decode === required.decode, whole.decode === space.decode);
same("encode", named_encode === space.encode, named_encode === whole.encode, named_encode === required.encode, named_encode === asked.encode, space.encode === required.encode, whole.encode === required.encode, asked.encode === required.encode, whole.encode === space.encode);
same("escape", named_escape === space.escape, named_escape === whole.escape, named_escape === required.escape, named_escape === asked.escape, space.escape === required.escape, whole.escape === required.escape, asked.escape === required.escape, whole.escape === space.escape);
same("parse", named_parse === space.parse, named_parse === whole.parse, named_parse === required.parse, named_parse === asked.parse, space.parse === required.parse, whole.parse === required.parse, asked.parse === required.parse, whole.parse === space.parse);
same("stringify", named_stringify === space.stringify, named_stringify === whole.stringify, named_stringify === required.stringify, named_stringify === asked.stringify, space.stringify === required.stringify, whole.stringify === required.stringify, asked.stringify === required.stringify, whole.stringify === space.stringify);
same("unescape", named_unescape === space.unescape, named_unescape === whole.unescape, named_unescape === required.unescape, named_unescape === asked.unescape, space.unescape === required.unescape, whole.unescape === required.unescape, asked.unescape === required.unescape, whole.unescape === space.unescape);
same("unescapeBuffer", named_unescapeBuffer === space.unescapeBuffer, named_unescapeBuffer === whole.unescapeBuffer, named_unescapeBuffer === required.unescapeBuffer, named_unescapeBuffer === asked.unescapeBuffer, space.unescapeBuffer === required.unescapeBuffer, whole.unescapeBuffer === required.unescapeBuffer, asked.unescapeBuffer === required.unescapeBuffer, whole.unescapeBuffer === space.unescapeBuffer);
