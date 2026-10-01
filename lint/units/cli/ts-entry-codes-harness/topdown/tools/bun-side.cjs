// DRAFT (see eslint-side.cjs). `bun --lint` of the debug build as the probe: the plain lines of stderr, read back per file.
// exports lint(files: [{ name, code }], { bun, jobs = 4, chunk = 400 }) -> Map(name -> { rejected: string|null, reports: [{ line, column, category, code, message }] })
// `rejected`: the first line that no rule wrote for the file (a syntax error with or without a number of tsc, an internal error).
// At most four processes run at a time. BUN_LINT_EXE names another executable.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const BUN = process.env.BUN_LINT_EXE || "/workspace/wt/cli/build/debug/bun-debug";
const LINE = /^(.+?)\((\d+),(\d+)\): (error|warning|suggestion|message) ([\w@/-]+): (.*)$/;

function run(bun, cwd, names) {
	return new Promise((resolve, reject) => {
		const env = { ...process.env, BUN_FEATURE_FLAG_EXPERIMENTAL_LINT: "1", BUN_DEBUG_QUIET_LOGS: "1", ASAN_OPTIONS: "detect_leaks=0:allow_user_segv_handler=1", NO_COLOR: "1" };
		const child = spawn(bun, ["--lint", ...names], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
		const out = [], err = [];
		child.stdout.on("data", d => out.push(d));
		child.stderr.on("data", d => err.push(d));
		child.on("error", reject);
		child.on("close", (code, signal) => {
			const stdout = Buffer.concat(out).toString("utf8");
			// 0: no error. 2: one or more. Anything else is a refusal or a crash: nothing of the run counts.
			if (signal || (code !== 0 && code !== 2) || stdout !== "") reject(new Error(`bun --lint: exit ${code} signal ${signal} stdout ${JSON.stringify(stdout.slice(0, 200))}\n${Buffer.concat(err).toString("utf8").slice(0, 2000)}`));
			else resolve(Buffer.concat(err).toString("utf8"));
		});
	});
}

async function lint(files, options = {}) {
	const bun = options.bun || BUN;
	const jobs = Math.min(options.jobs || 4, 4);
	const chunk = options.chunk || 400;
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lint-oracle-"));
	const result = new Map();
	try {
		for (const f of files) {
			fs.writeFileSync(path.join(dir, f.name), f.code);
			result.set(f.name, { rejected: null, reports: [] });
		}
		const chunks = [];
		for (let i = 0; i < files.length; i += chunk) chunks.push(files.slice(i, i + chunk).map(f => f.name));
		let next = 0;
		const worker = async () => {
			while (next < chunks.length) {
				const names = chunks[next++];
				const stderr = await run(bun, dir, names);
				let last = null;
				for (const line of stderr.split("\n")) {
					if (!line) continue;
					const m = LINE.exec(line);
					if (!m) {
						// A message of a chain belongs to the line before it. Any other line is not of the plain format.
						if (line.startsWith("  ") && last) last.message += "\n" + line;
						else throw new Error(`not a line of the plain format: ${JSON.stringify(line)}`);
						continue;
					}
					const entry = result.get(m[1]);
					if (!entry) throw new Error(`a line of no file of the run: ${JSON.stringify(line)}`);
					last = { line: Number(m[2]), column: Number(m[3]), category: m[4], code: m[5], message: m[6] };
					// `syntax` and a number of tsc are the parser. A warning of the parser does not stop the rules.
					if ((last.code === "syntax" || /^TS\d+$/.test(last.code) || last.code === "internal-error") && last.category === "error") entry.rejected = entry.rejected || line;
					else if (last.code !== "syntax") entry.reports.push(last);
				}
			}
		};
		await Promise.all(Array.from({ length: jobs }, worker));
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
	return result;
}

module.exports = { lint, BUN };
