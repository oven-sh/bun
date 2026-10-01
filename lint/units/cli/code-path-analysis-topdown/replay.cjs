// Research scratch: runs the calls that cpaprobe prints on ESLint's own CodePath and CodePathState (at the pin), and
// gives the arrows of every code path in the order the code paths end, as tests/lib/linter/code-path-analysis does.
// exports: replayAll(traceText) -> Map<file, string[] | {error}>;   run directly: node replay.cjs <trace.txt>  prints JSON.
"use strict";
const path = require("path");
const R = "/workspace/ref/eslint/lib/linter/code-path-analysis/";
const CodePath = require(path.join(R, "code-path"));
const CodePathSegment = require(path.join(R, "code-path-segment"));
const IdGenerator = require(path.join(R, "id-generator"));
const debug = require(path.join(R, "debug-helpers"));

// forwardCurrentToHead of code-path-analyzer.js, with `events` in place of the emitter.
function forward(codePath, events) {
	const state = CodePath.getState(codePath);
	const currentSegments = state.currentSegments;
	const headSegments = state.headSegments;
	const end = Math.max(currentSegments.length, headSegments.length);
	for (let i = 0; i < end; ++i) {
		const currentSegment = currentSegments[i];
		const headSegment = headSegments[i];
		if (currentSegment !== headSegment && currentSegment) {
			events.push(`${currentSegment.reachable ? "onCodePathSegmentEnd" : "onUnreachableCodePathSegmentEnd"} ${currentSegment.id}`);
		}
	}
	state.currentSegments = headSegments;
	for (let i = 0; i < end; ++i) {
		const currentSegment = currentSegments[i];
		const headSegment = headSegments[i];
		if (currentSegment !== headSegment && headSegment) {
			CodePathSegment.markUsed(headSegment);
			events.push(`${headSegment.reachable ? "onCodePathSegmentStart" : "onUnreachableCodePathSegmentStart"} ${headSegment.id}`);
		}
	}
}

function replay(lines) {
	const idGenerator = new IdGenerator("s");
	const arrows = [];
	const events = [];
	let codePath = null;
	const onLooped = (from, to) => {
		if (from.reachable && to.reachable) events.push(`onCodePathSegmentLoop ${from.id} ${to.id}`);
	};
	for (const line of lines) {
		if (line.startsWith("@")) {
			events.push(line);
			continue;
		}
		const space = line.indexOf(" ");
		const op = space < 0 ? line : line.slice(0, space);
		const rest = space < 0 ? "" : line.slice(space + 1);
		if (op === "start") {
			if (codePath) forward(codePath, events);
			codePath = new CodePath({ id: idGenerator.next(), origin: rest, upper: codePath, onLooped });
			events.push(`onCodePathStart ${codePath.id} ${rest}`);
			continue;
		}
		const state = CodePath.getState(codePath);
		if (op === "end") {
			state.makeFinal();
			for (const segment of state.currentSegments) {
				events.push(`${segment.reachable ? "onCodePathSegmentEnd" : "onUnreachableCodePathSegmentEnd"} ${segment.id}`);
			}
			state.currentSegments = [];
			events.push(`onCodePathEnd ${codePath.id}`);
			arrows.push(debug.makeDotArrows(codePath));
			codePath = codePath.upper;
		} else if (op === "F") {
			forward(codePath, events);
		} else if (op === "F-unless-reachable") {
			if (!state.forkContext.reachable) forward(codePath, events);
		} else {
			const args = rest ? JSON.parse(rest).map(a => (a === null && /Test$/u.test(op) ? void 0 : a)) : [];
			if (typeof state[op] !== "function") throw new Error(`no call ${op}`);
			state[op](...args);
		}
	}
	if (codePath) throw new Error("a code path is left open");
	return { arrows, events };
}

function replayAll(text) {
	const out = new Map();
	let name = null;
	let lines = [];
	const flush = () => {
		if (name === null) return;
		if (lines[0] === "PARSE_ERROR" || lines[0] === "CANNOT_READ_OR_INIT") {
			out.set(name, { error: lines.join("\n") });
		} else {
			try {
				out.set(name, replay(lines));
			} catch (e) {
				out.set(name, { error: `replay: ${e.stack}` });
			}
		}
	};
	for (const line of text.split("\n")) {
		if (line.startsWith("== ")) {
			flush();
			name = line.slice(3);
			lines = [];
		} else if (line !== "") lines.push(line);
	}
	flush();
	return out;
}

module.exports = { replayAll, forward };

if (require.main === module) {
	const text = require("fs").readFileSync(process.argv[2], "utf8");
	const out = {};
	for (const [k, v] of replayAll(text)) out[k] = v;
	console.log(JSON.stringify(out, null, 1));
}
