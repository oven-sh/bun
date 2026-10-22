// Two roads to one module: stream readable. It prints what plain Bun prints.
import * as space from "node:_stream_readable";
import whole from "node:_stream_readable";
import { ReadableState as named_ReadableState, from as named_from, fromWeb as named_fromWeb, toWeb as named_toWeb, wrap as named_wrap } from "node:_stream_readable";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const required = require("node:_stream_readable");
const asked = process.getBuiltinModule("node:_stream_readable");
function same(name, ...answers) { console.log(name + " " + answers.map(answer => (answer ? "T" : "F")).join("")); }
same("ReadableState", named_ReadableState === space.ReadableState, named_ReadableState === whole.ReadableState, named_ReadableState === required.ReadableState, named_ReadableState === asked.ReadableState, space.ReadableState === required.ReadableState, whole.ReadableState === required.ReadableState, asked.ReadableState === required.ReadableState, whole.ReadableState === space.ReadableState);
same("from", named_from === space.from, named_from === whole.from, named_from === required.from, named_from === asked.from, space.from === required.from, whole.from === required.from, asked.from === required.from, whole.from === space.from);
same("fromWeb", named_fromWeb === space.fromWeb, named_fromWeb === whole.fromWeb, named_fromWeb === required.fromWeb, named_fromWeb === asked.fromWeb, space.fromWeb === required.fromWeb, whole.fromWeb === required.fromWeb, asked.fromWeb === required.fromWeb, whole.fromWeb === space.fromWeb);
same("toWeb", named_toWeb === space.toWeb, named_toWeb === whole.toWeb, named_toWeb === required.toWeb, named_toWeb === asked.toWeb, space.toWeb === required.toWeb, whole.toWeb === required.toWeb, asked.toWeb === required.toWeb, whole.toWeb === space.toWeb);
same("wrap", named_wrap === space.wrap, named_wrap === whole.wrap, named_wrap === required.wrap, named_wrap === asked.wrap, space.wrap === required.wrap, whole.wrap === required.wrap, asked.wrap === required.wrap, whole.wrap === space.wrap);
