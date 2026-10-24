// Two roads to one module: stream promises. It prints what plain Bun prints.
import * as space from "node:stream/promises";
import whole from "node:stream/promises";
import { finished as named_finished, pipeline as named_pipeline } from "node:stream/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const required = require("node:stream/promises");
const asked = process.getBuiltinModule("node:stream/promises");
function same(name, ...answers) { console.log(name + " " + answers.map(answer => (answer ? "T" : "F")).join("")); }
same("finished", named_finished === space.finished, named_finished === whole.finished, named_finished === required.finished, named_finished === asked.finished, space.finished === required.finished, whole.finished === required.finished, asked.finished === required.finished, whole.finished === space.finished);
same("pipeline", named_pipeline === space.pipeline, named_pipeline === whole.pipeline, named_pipeline === required.pipeline, named_pipeline === asked.pipeline, space.pipeline === required.pipeline, whole.pipeline === required.pipeline, asked.pipeline === required.pipeline, whole.pipeline === space.pipeline);
