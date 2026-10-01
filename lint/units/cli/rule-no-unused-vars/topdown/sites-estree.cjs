// Research scratch of "rule-no-unused-vars": the site facts of probe/src/main.rs (one top-down walk of bun's tree) against
// the same facts read off ESLint's tree with parent pointers, as ESLint's rule reads them. JavaScript with espree,
// TypeScript with the parser of typescript-eslint. Compared by the byte offset of each identifier that both trees have.
// usage: node sites-estree.cjs [--probe /tmp/nuv/sitesprobe] [--show N] [--list files.txt] <file>...
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const espree = require("/workspace/ref/eslint/node_modules/espree");
const evk = require("/workspace/ref/eslint/node_modules/eslint-visitor-keys");
const req = require("module").createRequire("/workspace/ref/tseslint/");
const tsParser = req("@typescript-eslint/parser");
const args = process.argv.slice(2);
let probe = "/tmp/nuv/sitesprobe", show = 30;
const files = [];
while (args.length) {
	const a = args.shift();
	if (a === "--probe") probe = args.shift();
	else if (a === "--show") show = Number(args.shift());
	else if (a === "--list") files.push(...fs.readFileSync(args.shift(), "utf8").split("\n").filter(Boolean));
	else files.push(a);
}
const isFn = n => n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression";
const isLoop = n => /^(?:DoWhile|For|ForIn|ForOf|While)Statement$/.test(n.type);
const LOGICAL = new Set(["&&=", "||=", "??="]);
function parse(code, file) {
	const ext = file.split(".").pop();
	if (/^[cm]?tsx?$/.test(ext)) {
		try { const r = tsParser.parseForESLint(code, { range: true, sourceType: "module", ecmaFeatures: { jsx: ext === "tsx" }, filePath: file }); return { ast: r.ast, keys: r.visitorKeys }; } catch { return null; }
	}
	for (const sourceType of ext === "mjs" ? ["module"] : ext === "cjs" ? ["commonjs"] : ["module", "script", "commonjs"]) {
		try { return { ast: espree.parse(code, { ecmaVersion: "latest", sourceType, ecmaFeatures: { jsx: true }, range: true }), keys: evk.KEYS }; } catch {}
	}
	return null;
}
function unusedExpression(node) {
	const parent = node.parent;
	if (parent.type === "ExpressionStatement") return true;
	if (parent.type === "SequenceExpression") return parent.expressions.at(-1) !== node ? true : unusedExpression(parent);
	return false;
}
function facts(code, file) {
	const parsed = parse(code, file);
	if (!parsed) return null;
	const out = new Map();
	// The byte offset of each UTF-16 index.
	let ascii = true;
	for (let i = 0; i < code.length; i++) if (code.charCodeAt(i) > 127) { ascii = false; break; }
	let byteOf = i => i;
	if (!ascii) {
		const map = new Uint32Array(code.length + 1);
		let b = 0;
		for (let i = 0; i < code.length; i++) {
			map[i] = b;
			const c = code.codePointAt(i);
			if (c > 0xffff) { map[i + 1] = b; i++; b += 4; } else b += c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
		}
		map[code.length] = b;
		byteOf = i => map[i];
	}
	(function walk(node, parent) {
		if (!node || typeof node.type !== "string") return;
		node.parent = parent;
		if (node.type === "Identifier" || node.type === "JSXIdentifier") {
			let flags = "";
			if (parent.type === "AssignmentExpression" && parent.left === node) flags += "a" + (LOGICAL.has(parent.operator) ? "l" : "") + (unusedExpression(parent) ? "x" : "");
			if (parent.type === "UpdateExpression") flags += "u" + (unusedExpression(parent) ? "x" : "");
			if ((parent.type === "ForInStatement" || parent.type === "ForOfStatement") && (parent.left === node || parent.right === node)) {
				const first = parent.body.type === "BlockStatement" ? parent.body.body[0] : parent.body;
				if (first && first.type === "ReturnStatement") flags += "r";
			}
			let inLoop = false;
			for (let n = node; n && !isFn(n); n = n.parent) if (isLoop(n)) { inLoop = true; break; }
			if (inLoop) flags += "L";
			let f = node;
			while (f && !isFn(f)) f = f.parent;
			let verdict = " f:n";
			if (f) {
				verdict = " f:N";
				let child = f;
				for (let p = f.parent; p; child = p, p = p.parent) {
					if (p.type === "SequenceExpression") { if (p.expressions.at(-1) !== child) break; continue; }
					if (p.type === "CallExpression" || p.type === "NewExpression") { if (p.callee !== child) verdict = " f:y"; break; }
					if (p.type === "AssignmentExpression") { verdict = p.left.type === "Identifier" && p.left.name === node.name ? " f:As" : " f:Ao"; break; }
					if (p.type === "TaggedTemplateExpression" || p.type === "YieldExpression") { verdict = " f:y"; break; }
					if (p.type.endsWith("Statement") || p.type.endsWith("Declaration")) { verdict = " f:y"; break; }
				}
			}
			out.set(byteOf(node.range[0]), { flags: flags + verdict, role: flags !== "" && /[aur]/.test(flags) });
		}
		for (const k of parsed.keys[node.type] || evk.getKeys(node)) {
			const c = node[k];
			if (Array.isArray(c)) for (const x of c) walk(x, node);
			else walk(c, node);
		}
	})(parsed.ast, null);
	return out;
}
const tally = { files: 0, "estree-rejects": 0, "bun-rejects": 0, identifiers: 0, same: 0, different: 0, "only-bun": 0, "role-missing-in-bun": 0, "files-different": 0 };
const shown = [];
for (let i = 0; i < files.length; i += 200) {
	const chunk = files.slice(i, i + 200);
	const r = spawnSync(probe, chunk, { encoding: "utf8", env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0" }, maxBuffer: 1 << 30 });
	if (r.status !== 0) { console.log(`probe ended with ${r.status} ${r.signal} in the chunk at ${i}: ${(r.stderr || "").slice(-300)}`); }
	const byFile = new Map();
	let current = null;
	for (const line of (r.stdout || "").split("\n")) {
		if (line.startsWith("== ")) { current = { lines: new Map(), rejected: false }; byFile.set(line.slice(3), current); }
		else if (!current) continue;
		else if (line === "PARSE_ERROR" || line === "CANNOT_READ_OR_INIT") current.rejected = true;
		else { const t = line.indexOf("\t"); if (t > 0) current.lines.set(Number(line.slice(0, t)), line.slice(t + 1)); }
	}
	for (const f of chunk) {
		tally.files += 1;
		let code;
		try { code = fs.readFileSync(f, "utf8"); } catch { continue; }
		const mine = byFile.get(f);
		if (!mine || mine.rejected) { tally["bun-rejects"] += 1; continue; }
		// The probe reads the bytes of the file: a byte order mark is three of them.
		const bom = code.charCodeAt(0) === 0xfeff ? 3 : 0;
		const theirs = facts(bom ? code.slice(1) : code, f);
		if (!theirs) { tally["estree-rejects"] += 1; continue; }
		let bad = 0;
		for (const [at, flags] of mine.lines) {
			const t = theirs.get(at - bom);
			if (!t) { tally["only-bun"] += 1; continue; }
			tally.identifiers += 1;
			if (t.flags === flags) tally.same += 1;
			else { tally.different += 1; bad += 1; if (shown.length < show) shown.push(`${f} @${at}: bun "${flags}" estree "${t.flags}" : ${JSON.stringify(code.slice(0, 1e9)).length > 0 ? JSON.stringify(Buffer.from(code).subarray(Math.max(0, at - 40), at + 30).toString()) : ""}`); }
		}
		for (const [at, t] of theirs) if (t.role && !mine.lines.has(at + bom)) { tally["role-missing-in-bun"] += 1; if (shown.length < show) shown.push(`${f} @${at}: estree "${t.flags}" and no identifier of bun : ${JSON.stringify(Buffer.from(code).subarray(Math.max(0, at - 40), at + 30).toString())}`); }
		if (bad) tally["files-different"] += 1;
	}
}
console.log(JSON.stringify(tally));
for (const s of shown) console.log(s);
