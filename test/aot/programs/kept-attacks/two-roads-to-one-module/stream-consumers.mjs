// Two roads to one module: stream consumers. It prints what plain Bun prints.
import * as space from "node:stream/consumers";
import whole from "node:stream/consumers";
import { arrayBuffer as named_arrayBuffer, blob as named_blob, buffer as named_buffer, bytes as named_bytes, json as named_json, text as named_text } from "node:stream/consumers";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const required = require("node:stream/consumers");
const asked = process.getBuiltinModule("node:stream/consumers");
function same(name, ...answers) { console.log(name + " " + answers.map(answer => (answer ? "T" : "F")).join("")); }
same("arrayBuffer", named_arrayBuffer === space.arrayBuffer, named_arrayBuffer === whole.arrayBuffer, named_arrayBuffer === required.arrayBuffer, named_arrayBuffer === asked.arrayBuffer, space.arrayBuffer === required.arrayBuffer, whole.arrayBuffer === required.arrayBuffer, asked.arrayBuffer === required.arrayBuffer, whole.arrayBuffer === space.arrayBuffer);
same("blob", named_blob === space.blob, named_blob === whole.blob, named_blob === required.blob, named_blob === asked.blob, space.blob === required.blob, whole.blob === required.blob, asked.blob === required.blob, whole.blob === space.blob);
same("buffer", named_buffer === space.buffer, named_buffer === whole.buffer, named_buffer === required.buffer, named_buffer === asked.buffer, space.buffer === required.buffer, whole.buffer === required.buffer, asked.buffer === required.buffer, whole.buffer === space.buffer);
same("bytes", named_bytes === space.bytes, named_bytes === whole.bytes, named_bytes === required.bytes, named_bytes === asked.bytes, space.bytes === required.bytes, whole.bytes === required.bytes, asked.bytes === required.bytes, whole.bytes === space.bytes);
same("json", named_json === space.json, named_json === whole.json, named_json === required.json, named_json === asked.json, space.json === required.json, whole.json === required.json, asked.json === required.json, whole.json === space.json);
same("text", named_text === space.text, named_text === whole.text, named_text === required.text, named_text === asked.text, space.text === required.text, whole.text === required.text, asked.text === required.text, whole.text === space.text);
