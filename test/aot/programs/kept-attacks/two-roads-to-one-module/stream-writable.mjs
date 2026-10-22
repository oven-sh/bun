// Two roads to one module: stream writable. It prints what plain Bun prints.
import * as space from "node:_stream_writable";
import whole from "node:_stream_writable";
import { WritableState as named_WritableState, fromWeb as named_fromWeb, toWeb as named_toWeb } from "node:_stream_writable";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const required = require("node:_stream_writable");
const asked = process.getBuiltinModule("node:_stream_writable");
function same(name, ...answers) { console.log(name + " " + answers.map(answer => (answer ? "T" : "F")).join("")); }
same("WritableState", named_WritableState === space.WritableState, named_WritableState === whole.WritableState, named_WritableState === required.WritableState, named_WritableState === asked.WritableState, space.WritableState === required.WritableState, whole.WritableState === required.WritableState, asked.WritableState === required.WritableState, whole.WritableState === space.WritableState);
same("fromWeb", named_fromWeb === space.fromWeb, named_fromWeb === whole.fromWeb, named_fromWeb === required.fromWeb, named_fromWeb === asked.fromWeb, space.fromWeb === required.fromWeb, whole.fromWeb === required.fromWeb, asked.fromWeb === required.fromWeb, whole.fromWeb === space.fromWeb);
same("toWeb", named_toWeb === space.toWeb, named_toWeb === whole.toWeb, named_toWeb === required.toWeb, named_toWeb === asked.toWeb, space.toWeb === required.toWeb, whole.toWeb === required.toWeb, asked.toWeb === required.toWeb, whole.toWeb === space.toWeb);
