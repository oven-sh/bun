// asker.cjs requires, by a name with a written default, the ES module that imports it, while root.mjs, which imports both, is loaded.
// The loader loads that cycle and what comes to it, as where the name is written: loader-mark-follows-the-require-cycle.mjs.
// RUN(ASKED): link
// ASKED: path="{{*}}/asked.mjs"{{*}}IsLoadedByLoader, IsRequiredDuringLoad
// RUN(ASKER): link
// ASKER: path="{{*}}/asker.cjs"{{*}}IsLoadedByLoader, IsImportableDuringEvaluation
// RUN(ROOT): link
// ROOT: path="{{*}}/root.mjs"{{*}}IsLoadedByLoader

// FILE: main.cjs
require("./root.mjs");

// FILE: root.mjs
import "./asker.cjs";
import "./asked.mjs";

// FILE: asker.cjs
exports.first = 1;
exports.seen = typeof require(process.env.MADE_UP_NONE || "./asked.mjs").value;

// FILE: asked.mjs
import asker from "./asker.cjs";
export const value = typeof asker.first;
