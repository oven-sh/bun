// Two roads to one module: stream duplex. It prints what plain Bun prints.
import * as space from "node:_stream_duplex";
import whole from "node:_stream_duplex";
import { from as named_from, fromWeb as named_fromWeb, toWeb as named_toWeb } from "node:_stream_duplex";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const required = require("node:_stream_duplex");
const asked = process.getBuiltinModule("node:_stream_duplex");
function same(name, ...answers) { console.log(name + " " + answers.map(answer => (answer ? "T" : "F")).join("")); }
same("from", named_from === space.from, named_from === whole.from, named_from === required.from, named_from === asked.from, space.from === required.from, whole.from === required.from, asked.from === required.from, whole.from === space.from);
same("fromWeb", named_fromWeb === space.fromWeb, named_fromWeb === whole.fromWeb, named_fromWeb === required.fromWeb, named_fromWeb === asked.fromWeb, space.fromWeb === required.fromWeb, whole.fromWeb === required.fromWeb, asked.fromWeb === required.fromWeb, whole.fromWeb === space.fromWeb);
same("toWeb", named_toWeb === space.toWeb, named_toWeb === whole.toWeb, named_toWeb === required.toWeb, named_toWeb === asked.toWeb, space.toWeb === required.toWeb, whole.toWeb === required.toWeb, asked.toWeb === required.toWeb, whole.toWeb === space.toWeb);
