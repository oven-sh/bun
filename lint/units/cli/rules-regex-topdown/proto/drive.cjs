// Research scratch of "rules-regex" (top-down pass). The five regex rules AS PLANNED for D3 against ESLint at the pin.
// The plan is two parts. (1) Which nodes of Bun's tree a rule reads and where a report goes: the native probe prints them
// (probe/src/rx.rs, mode `rx`). (2) What a rule says of a pattern: ESLint's own rule code, run here on stand-in nodes that
// are built from the probe's lines, so the only differences that can show are those of part 1 and of the D3 seam.
// usage: node drive.cjs [--show] [--rule <name>]... [--probe /tmp/rxr/probe] [--dump out.jsonl] <cases.json>...
// cases: a JSON array of strings, of { code, ext?, jsx? }, or the output of ../rules-source-text/oracle/upstream.cjs.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const ESLINT = "/workspace/ref/eslint";
const { verify } = require("/workspace/notes/lint/units/cli/ts-entry-codes-harness/topdown/tools/eslint-side.cjs");
const ALL = ["no-control-regex", "no-regex-spaces", "no-useless-backreference", "no-misleading-character-class", "no-useless-escape"];
const argv = process.argv.slice(2);
let show = false, probe = "/tmp/rxr/probe", dump = null;
const only = [], files = [];
while (argv.length) {
	const a = argv.shift();
	if (a === "--show") show = true;
	else if (a === "--rule") only.push(argv.shift());
	else if (a === "--probe") probe = argv.shift();
	else if (a === "--dump") dump = argv.shift();
	else files.push(a);
}
const RULES = only.length ? only : ALL;
const rules = Object.fromEntries(RULES.map(r => [r, require(path.join(ESLINT, "lib/rules", r))]));

// ---- the cases
const cases = [];
const seen = new Set();
for (const f of files) {
	for (const raw of JSON.parse(fs.readFileSync(f, "utf8"))) {
		const c = typeof raw === "string" ? { code: raw } : raw;
		if (typeof c.code !== "string") continue;
		const lo = c.languageOptions || {};
		const jsx = !!(c.jsx || (lo.parserOptions && lo.parserOptions.ecmaFeatures && lo.parserOptions.ecmaFeatures.jsx));
		const ext = c.ext || (jsx ? "jsx" : "js");
		const key = `${ext}:${c.code}`;
		if (seen.has(key)) continue;
		seen.add(key);
		cases.push({ code: c.code, ext, from: path.basename(f) });
	}
}

// ---- ESLint's answer, and the extension that carries the case
for (const c of cases) {
	const r = verify(c.code, c.ext, RULES);
	c.ext = r.ext;
	c.fatal = r.fatal ? `${r.fatal.line}:${r.fatal.column} ${r.fatal.message}` : null;
	c.eslint = r.messages.map(m => ({ rule: m.ruleId, line: m.line, column: m.column, message: m.message }));
}

// ---- the probe
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rxr-"));
cases.forEach((c, i) => {
	c.name = `c${String(i).padStart(5, "0")}.${c.ext}`;
	fs.writeFileSync(path.join(dir, c.name), c.code);
});
const byName = new Map(cases.map(c => [c.name, c]));
for (let i = 0; i < cases.length; i += 400) {
	const names = cases.slice(i, i + 400).map(c => c.name);
	const out = execFileSync(probe, ["rx", ...names], { cwd: dir, env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0" }, maxBuffer: 1 << 28, encoding: "utf8" });
	for (const line of out.split("\n")) {
		if (!line) continue;
		const tab = line.indexOf("\t");
		const c = byName.get(line.slice(0, tab));
		const rest = line.slice(tab + 1);
		if (!c) continue;
		if (rest === "OK") c.sites = [];
		else if (rest === "PARSE_ERROR") c.rejected = true;
		else c.sites.push(JSON.parse(rest));
	}
}
fs.rmSync(dir, { recursive: true, force: true });

// ---- stand-in nodes and ESLint's rule code on them
const unhex16 = h => { let s = ""; for (let i = 0; i < h.length; i += 4) s += String.fromCharCode(parseInt(h.slice(i, i + 4), 16)); return s; };
function stringEnd(text, at) {
	const q = text[at];
	let i = at + 1;
	while (i < text.length) {
		if (text[i] === "\\") { i += 2; continue; }
		if (text[i] === q) return i + 1;
		i++;
	}
	return text.length;
}
function quasiEnd(text, at) {
	let i = at + 1;
	while (i < text.length) {
		if (text[i] === "\\") { i += 2; continue; }
		if (text[i] === "`") return i + 1;
		if (text[i] === "$" && text[i + 1] === "{") return i + 2;
		i++;
	}
	return text.length;
}
const interpolate = (text, data) => text.replace(/\{\{([^{}]+?)\}\}/gu, (full, term) => (data && term.trim() in data ? data[term.trim()] : full));

function planned(c) {
	const text = c.code;
	const buf = Buffer.from(text, "utf8");
	// byte offset -> UTF-16 index
	const b2u = new Uint32Array(buf.length + 2);
	for (let i = 0, u = 0; i <= buf.length; ) {
		const b = buf[i];
		const n = i === buf.length ? 1 : b < 0x80 ? 1 : b < 0xe0 ? 2 : b < 0xf0 ? 3 : 4;
		for (let k = 0; k < n; k++) b2u[i + k] = u;
		u += n === 4 ? 2 : 1;
		i += n;
	}
	const lineStarts = [0];
	for (const m of text.matchAll(/\r\n|[\r\n\u2028\u2029]/gu)) lineStarts.push(m.index + m[0].length);
	const locOf = index => {
		let lo = 0, hi = lineStarts.length - 1;
		while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= index) lo = mid; else hi = mid - 1; }
		return { line: lo + 1, column: index - lineStarts[lo] };
	};
	const mk = (type, range, extra) => ({ type, range, loc: { start: locOf(range[0]), end: locOf(range[1]) }, ...extra });
	const sites = c.sites;
	const found = sites.find(s => s.k === "seam");
	// D3: a name is the global when the file declares it nowhere and assigns to it nowhere.
	const seam = { RegExp: found.RegExp && !(found.written & 1), globalThis: found.globalThis && !(found.written & 2) };
	const X = { type: "X" };
	const lits = new Map();
	for (const s of sites) {
		if (s.k !== "lit") continue;
		const raw = Buffer.from(s.raw, "hex").toString("utf8");
		const start = b2u[s.at], last = raw.lastIndexOf("/");
		lits.set(s.at, mk("Literal", [start, start + raw.length], { raw, value: null, regex: { pattern: raw.slice(1, last), flags: raw.slice(last + 1) }, parent: X }));
	}
	function argNode(a) {
		const own = b2u[a.loc];
		if (!a.ts) {
			if (a.t === "str") { const end = stringEnd(text, own); return mk("Literal", [own, end], { value: unhex16(a.u), raw: text.slice(own, end) }); }
			if (a.t === "tpl") { const end = quasiEnd(text, own); return mk("TemplateLiteral", [own, end], { expressions: [], quasis: [{ value: { cooked: unhex16(a.u) } }] }); }
			if (a.t === "re") return lits.get(a.loc);
		}
		const s = b2u[a.at];
		if (a.t === "spread") return mk("SpreadElement", [s, s + 1], {});
		if (a.t === "re") {
			// Behind a TypeScript wrapper the evaluation gives the object of the literal.
			const lit = lits.get(a.loc);
			const value = Object.create(RegExp.prototype, { source: { value: lit.regex.pattern }, flags: { value: lit.regex.flags } });
			return mk("TSAsExpression", [s, s + 1], { expression: { type: "Literal", value, regex: lit.regex } });
		}
		if (a.v !== null) return mk("TSAsExpression", [s, s + 1], { expression: { type: "Literal", value: unhex16(a.v) } });
		return mk("Identifier", [s, s + 1], { name: a.un ? "$undeclared" : "$unknown", unknown: !a.un });
	}
	const calls = sites.filter(s => s.k === "call").map(s => {
		const start = b2u[s.at];
		const node = mk(s.new ? "NewExpression" : "CallExpression", [start, start + 1], {});
		node.callee = { type: "Identifier", name: "RegExp", parent: node };
		node.arguments = s.args.map(argNode);
		for (const a of node.arguments) if (!a.parent || a.parent === X) a.parent = node;
		return { s, node };
	});
	const out = [];
	for (const name of RULES) {
		const rule = rules[name];
		// The references of the global that ReferenceTracker is given: a call whose target reaches the name, while the file declares the name nowhere.
		const tracked = calls.filter(({ s, node }) => {
			if (s.tracked === 0 || !(s.tracked === 1 ? seam.RegExp : seam.globalThis)) return false;
			// D3: flags that are written and not known are not taken for absent, but a bare name that the file declares nowhere is.
			if (name === "no-useless-backreference" && node.arguments[1] && node.arguments[1].unknown) return false;
			return true;
		});
		const variable = { defs: [], references: tracked.map(({ node }) => ({ isRead: () => true, isWrite: () => false, identifier: node.callee })) };
		const scope = { type: "global", set: new Map([["RegExp", variable]]), upper: null, childScopes: [], block: { range: [0, text.length] }, variables: [variable] };
		const sourceCode = {
			text,
			getText: node => text.slice(node.range[0], node.range[1]),
			getLocFromIndex: locOf,
			getScope: () => scope,
			isGlobalReference: () => true,
		};
		const context = {
			sourceCode,
			options: rule.meta.defaultOptions ? structuredClone(rule.meta.defaultOptions) : [],
			languageOptions: { ecmaVersion: 2026, sourceType: "module" },
			report(d) {
				const start = d.loc ? d.loc.start || d.loc : d.node.loc.start;
				out.push({ rule: name, line: start.line, column: start.column + 1, message: interpolate(rule.meta.messages[d.messageId], d.data) });
			},
		};
		const h = rule.create(context);
		if (h.Program) h.Program(mk("Program", [0, text.length], {}));
		const literal = node => { for (const k of ["Literal", "Literal[regex]"]) if (h[k]) h[k](node); };
		const plainCalls = calls.filter(({ s }) => s.ident && s.plain && seam.RegExp);
		for (const s of sites) {
			if (s.k === "lit") literal(lits.get(s.at));
			else if (s.k === "str" && name === "no-useless-escape") {
				const start = b2u[s.at], end = stringEnd(text, start);
				h.Literal(mk("Literal", [start, end], { value: "", raw: text.slice(start, end), parent: X }));
			} else if (s.k === "quasi" && name === "no-useless-escape") {
				const start = b2u[s.at];
				h.TemplateElement(mk("TemplateElement", [start, quasiEnd(text, start)], { parent: { type: "TemplateLiteral", parent: X } }));
			}
		}
		for (const { s, node } of plainCalls) {
			if (name === "no-control-regex") {
				const first = node.arguments[0];
				if (first && first.type === "Literal" && typeof first.value === "string") h.Literal(first);
			} else if (name === "no-regex-spaces") h[node.type](node);
		}
	}
	return out;
}

// ---- the comparison
const fmt = r => `${r.line}:${r.column} ${r.message}`;
const tally = {};
const lines = [];
for (const c of cases) {
	if (c.fatal || c.rejected) {
		const k = c.fatal && c.rejected ? "both reject" : c.fatal ? "only ESLint rejects" : "only Bun rejects";
		tally[k] = (tally[k] || 0) + 1;
		if (show) console.log(`[${k}] ${c.ext} ${JSON.stringify(c.code)}${c.fatal ? `  ${c.fatal}` : ""}`);
		continue;
	}
	const plan = planned(c);
	if (dump) lines.push(JSON.stringify({ code: c.code, ext: c.ext, planned: plan, eslint: c.eslint }));
	for (const name of RULES) {
		const want = c.eslint.filter(r => r.rule === name).map(fmt).sort();
		const got = plan.filter(r => r.rule === name).map(fmt).sort();
		let k = "same";
		if (JSON.stringify(want) !== JSON.stringify(got)) {
			const w = new Set(want), g = new Set(got);
			k = got.every(x => w.has(x)) ? "missing" : want.every(x => g.has(x)) ? "extra" : "other";
		}
		tally[`${name} ${k}`] = (tally[`${name} ${k}`] || 0) + 1;
		if (k !== "same" && show) console.log(`[${name} ${k}] ${c.ext} ${JSON.stringify(c.code)}\n    eslint:  ${want.join(" | ") || "(none)"}\n    planned: ${got.join(" | ") || "(none)"}`);
	}
}
if (dump) fs.writeFileSync(dump, lines.join("\n") + "\n");
console.log(`${cases.length} cases`);
for (const k of Object.keys(tally).sort()) console.log(`  ${tally[k]}\t${k}`);
