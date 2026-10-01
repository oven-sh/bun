// SCRATCH of the research unit "ts-entry-codes-harness". For every fixture of the tree: the cases as files, one run of the debug
// build (JavaScript through Parser::parse_only) and one of the probe (every loader through Parser::parse_for_lint_with_codes),
// and whether the two wrote the same bytes to stderr and ended with the same exit code.
// usage: node same-bytes.cjs [--rules dir] [--bun path] [--probe path]
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const args = process.argv.slice(2);
let rulesDir = "/workspace/wt/cli/test/cli/lint/rules", bun = "/workspace/wt/cli/build/debug/bun-debug", probe = "/tmp/tsentry/tsentry";
while (args.length) {
	const a = args.shift();
	if (a === "--rules") rulesDir = args.shift();
	else if (a === "--bun") bun = args.shift();
	else if (a === "--probe") probe = args.shift();
}
const env = { ...process.env, BUN_FEATURE_FLAG_EXPERIMENTAL_LINT: "1", BUN_DEBUG_QUIET_LOGS: "1", ASAN_OPTIONS: "detect_leaks=0:allow_user_segv_handler=1" };
let total = 0, differing = 0;
for (const f of fs.readdirSync(rulesDir).filter(f => f.endsWith(".json")).sort()) {
	const cases = JSON.parse(fs.readFileSync(path.join(rulesDir, f), "utf8"));
	const names = cases.map((c, i) => `c${String(i).padStart(4, "0")}.${c.ext ?? (c.jsx ? "jsx" : "js")}`);
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "same-bytes-"));
	cases.forEach((c, i) => fs.writeFileSync(path.join(dir, names[i]), c.code));
	const run = exe => spawnSync(exe, ["--lint", ...names], { cwd: dir, env, encoding: "utf8", maxBuffer: 1 << 28 });
	const a = run(bun), b = run(probe);
	fs.rmSync(dir, { recursive: true, force: true });
	total += cases.length;
	const same = a.stderr === b.stderr && a.status === b.status && a.stdout === "" ;
	if (!same) {
		differing += 1;
		const la = a.stderr.split("\n"), lb = new Set(b.stderr.split("\n"));
		const sa = new Set(la);
		console.log(`DIFFERENT ${f}: exit ${a.status} / ${b.status}`);
		for (const l of la) if (!lb.has(l)) console.log(`   only the build: ${l}`);
		for (const l of lb) if (!sa.has(l)) console.log(`   only the probe: ${l}`);
	} else console.log(`same ${f}: ${cases.length} cases, ${a.stderr.split("\n").length - 1} lines, exit ${a.status}`);
}
console.log(`${total} cases, ${differing} fixtures differ`);
