// Two roads to one module: timers promises. It prints what plain Bun prints.
import * as space from "node:timers/promises";
import whole from "node:timers/promises";
import { scheduler as named_scheduler, setImmediate as named_setImmediate, setInterval as named_setInterval, setTimeout as named_setTimeout } from "node:timers/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const required = require("node:timers/promises");
const asked = process.getBuiltinModule("node:timers/promises");
function same(name, ...answers) { console.log(name + " " + answers.map(answer => (answer ? "T" : "F")).join("")); }
same("scheduler", named_scheduler === space.scheduler, named_scheduler === whole.scheduler, named_scheduler === required.scheduler, named_scheduler === asked.scheduler, space.scheduler === required.scheduler, whole.scheduler === required.scheduler, asked.scheduler === required.scheduler, whole.scheduler === space.scheduler);
same("setImmediate", named_setImmediate === space.setImmediate, named_setImmediate === whole.setImmediate, named_setImmediate === required.setImmediate, named_setImmediate === asked.setImmediate, space.setImmediate === required.setImmediate, whole.setImmediate === required.setImmediate, asked.setImmediate === required.setImmediate, whole.setImmediate === space.setImmediate);
same("setInterval", named_setInterval === space.setInterval, named_setInterval === whole.setInterval, named_setInterval === required.setInterval, named_setInterval === asked.setInterval, space.setInterval === required.setInterval, whole.setInterval === required.setInterval, asked.setInterval === required.setInterval, whole.setInterval === space.setInterval);
same("setTimeout", named_setTimeout === space.setTimeout, named_setTimeout === whole.setTimeout, named_setTimeout === required.setTimeout, named_setTimeout === asked.setTimeout, space.setTimeout === required.setTimeout, whole.setTimeout === required.setTimeout, asked.setTimeout === required.setTimeout, whole.setTimeout === space.setTimeout);
