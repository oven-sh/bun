// Research scratch: which entries of code-path-analysis.txt a port WITHOUT one of upstream's quirks would fail.
// usage: node pin-check.cjs remove|unreachable     remove: removeFromArray does nothing when the value is missing;
//                                                 unreachable: makeUnreachable() without arguments makes no segment.
"use strict";
const Module = require("module");
const fs = require("fs");
const path = require("path");
const which = process.argv[2];
const target = "/workspace/ref/eslint/lib/linter/code-path-analysis/code-path-state.js";
const compile = Module.prototype._compile;
Module.prototype._compile = function (content, filename) {
	if (filename === target) {
		if (which === "remove") content = content.replace("elements.splice(elements.indexOf(value), 1);", "if (elements.indexOf(value) >= 0) elements.splice(elements.indexOf(value), 1);");
		if (which === "unreachable") content = content.replace("this.forkContext.makeUnreachable();", "");
	}
	return compile.call(this, content, filename);
};
const { replayAll } = require("./replay.cjs");
const text = fs.readFileSync(path.join(__dirname, "code-path-analysis.txt"), "utf8");
const entries = [];
let cur = null;
for (const line of text.split("\n")) {
	if (line.startsWith("== ")) { cur = { name: line.slice(3), arrows: [], block: [], events: [], ops: [] }; entries.push(cur); }
	else if (line.startsWith("| ") || line === "|") continue;
	else if (line === ">>") { cur.arrows.push(cur.block.join("\n")); cur.block = []; }
	else if (line.startsWith("> ")) cur.block.push(line.slice(2));
	else if (line.startsWith("! ")) cur.events.push(line.slice(2));
	else if (line !== "") cur.ops.push(line);
}
const trace = entries.map(e => `== ${e.name}\n${e.ops.join("\n")}`).join("\n");
const replayed = replayAll(trace);
const failing = [];
let arrowsOnly = 0;
for (const e of entries) {
	const got = replayed.get(e.name);
	const a = got.arrows && JSON.stringify(got.arrows) === JSON.stringify(e.arrows);
	const v = got.events && JSON.stringify(got.events) === JSON.stringify(e.events);
	if (!a || !v) { failing.push(e.name); if (!a && v) arrowsOnly++; }
}
console.log(`${which || "as upstream"}: entries ${entries.length}, failing ${failing.length} (arrows differ and events do not: ${arrowsOnly})`, failing.slice(0, 12).join(" "));
