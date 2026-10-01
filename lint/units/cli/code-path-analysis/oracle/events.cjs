// ESLint at the pin: the code path events of each fixture, in the order a rule gets them, with no place of a node in
// them, so that another implementation can print the same lines while it walks.
// One line per event: "pathstart <path> <origin>", "start <segment>", "end <segment>", "ustart <segment>",
// "uend <segment>", "loop <from> <to>", "pathend <path> returned=<ids> thrown=<ids> final=<ids>".
// usage: node events.cjs <out.txt> <dir>...   each fixture is a section "== <file name>".
"use strict";
const fs = require("fs");
const path = require("path");
const R = "/workspace/ref/eslint";
const { Linter } = require(path.join(R, "lib/linter"));
const linter = new Linter();
const languageOptionsPattern = /\/\*languageOptions\s((?:.|[\r\n])+?)\*\//u;
const [outFile, ...dirs] = process.argv.slice(2);
let text = "";
let files = 0, events = 0;
for (const dir of dirs) {
	for (const file of fs.readdirSync(dir).sort()) {
		const source = fs.readFileSync(path.join(dir, file), "utf8");
		const m = languageOptionsPattern.exec(source);
		const out = [];
		const ids = s => s.map(x => x.id).join(",");
		const rule = { create: () => ({
			onCodePathStart(codePath) { out.push(`pathstart ${codePath.id} ${codePath.origin}`); },
			onCodePathEnd(codePath) { out.push(`pathend ${codePath.id} returned=${ids(codePath.returnedSegments)} thrown=${ids(codePath.thrownSegments)} final=${ids(codePath.finalSegments)}`); },
			onCodePathSegmentStart(segment) { out.push(`start ${segment.id}`); },
			onCodePathSegmentEnd(segment) { out.push(`end ${segment.id}`); },
			onUnreachableCodePathSegmentStart(segment) { out.push(`ustart ${segment.id}`); },
			onUnreachableCodePathSegmentEnd(segment) { out.push(`uend ${segment.id}`); },
			onCodePathSegmentLoop(from, to) { out.push(`loop ${from.id} ${to.id}`); },
		}) };
		const messages = linter.verify(source, { plugins: { t: { rules: { r: rule } } }, rules: { "t/r": 2 }, languageOptions: m ? JSON.parse(m[1]) : {} });
		if (messages.length) throw new Error(`${file}: ${messages[0].message}`);
		text += `== ${file}\n${out.join("\n")}\n`;
		files++;
		events += out.length;
	}
}
fs.writeFileSync(outFile, text);
console.log("files", files, "events", events, "bytes", text.length);
