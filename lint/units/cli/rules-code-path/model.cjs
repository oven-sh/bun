// Research scratch (rules-code-path, pass 1a): getter-return, no-fallthrough, constructor-super and no-this-before-super
// as they can be written on Bun's tree: no parent pointers (what a rule needs of a parent is said from above), the code
// path events arrive while the walk runs (driver.cjs of ../code-path-analysis/proto), and the two constructor rules keep
// the steps of a constructor and run ESLint's handlers over them when its code path ends (the graph is final then).
// usage: node model.cjs [--upstream] [--list cases.json]... [--files list.txt] [--live] [--show]
//   --upstream: cases/upstream-<rule>.raw.json of the four rules.   --live: also runs the two constructor rules without
//   the replay (handlers run while the walk runs) and counts where that differs.
"use strict";
const fs = require("fs");
const path = require("path");
const R = "/workspace/ref/eslint";
const { Linter } = require(path.join(R, "lib/linter"));
const P = path.join(__dirname, "../code-path-analysis/proto");
const bunshape = require(path.join(P, "bunshape.cjs"));
const { Driver } = require(path.join(P, "driver.cjs"));

const RULES = ["getter-return", "no-fallthrough", "constructor-super", "no-this-before-super"];

// ---------------------------------------------------------------------------------------------------------------
// Helpers on Bun's shape.
// ---------------------------------------------------------------------------------------------------------------
// `getStaticStringValue` of a key or of an index: E::String (a name, a string, a template without substitutions),
// E::Number, E::BigInt, E::Boolean, E::Null, E::RegExp.
function staticString(e) {
	switch (e.t) {
		case "EString": return e.value;
		case "ENumber": return String(e.value);
		case "EBigInt": return e.value;
		case "EBoolean": return String(e.value);
		case "ENull": return "null";
		case "ERegExp": return `/${e.src.regex.pattern}/${e.src.regex.flags}`;
		default: return null;
	}
}
// `getStaticPropertyName` of a property: a key that is a name is E::String; a computed name (E::Identifier) is dynamic.
const keyName = p => (p.key.t === "EPrivateIdentifier" ? null : staticString(p.key));
const isFunction = e => !!e && (e.t === "EFunction" || (e.t === "EArrow" && !e.prefer_expr));

// `isPossibleConstructor` of constructor-super on Bun's shape.
function isPossibleConstructor(e) {
	if (!e) return false;
	switch (e.t) {
		case "EClass": case "EFunction": case "EThis": case "EDot": case "EIndex": case "ECall": case "ENew": case "EYield":
		case "ENewTarget": case "EImportMeta":
			return true;
		case "ETemplate":
			return e.tag !== null;
		case "EIdentifier":
			return e.name !== "undefined";
		case "EBinary":
			switch (e.op) {
				case "=": case "&&=": case "&&": return isPossibleConstructor(e.right);
				case "||=": case "??=": case "||": case "??": return isPossibleConstructor(e.left) || isPossibleConstructor(e.right);
				case ",": return isPossibleConstructor(e.right);
				default: return false;
			}
		case "EIf":
			return isPossibleConstructor(e.no) || isPossibleConstructor(e.yes);
		default:
			return false;
	}
}
// `astUtils.isNullOrUndefined`.
const isNullOrUndefined = e => e.t === "ENull" || (e.t === "EIdentifier" && e.name === "undefined") || (e.t === "EUnary" && e.op === "void");

function lineOf(source, offset) {
	let line = 1;
	for (let i = 0; i < offset; i++) {
		const c = source.charCodeAt(i);
		if (c === 10 || c === 0x2028 || c === 0x2029) line++;
		else if (c === 13 && source.charCodeAt(i + 1) !== 10) line++;
	}
	return line;
}

// ---------------------------------------------------------------------------------------------------------------
// ESLint's handlers of the two constructor rules as machines over the steps of one constructor of a class with
// `extends`. Replay: every step is fed when the code path has ended (the graph is final). Live: when it happens.
// ---------------------------------------------------------------------------------------------------------------
function constructorSuper(info, report) {
	const segInfoMap = new Map();
	const current = new Set();
	const some = s => s.reachable && !!segInfoMap.get(s.id) && segInfoMap.get(s.id).calledInSomePaths;
	const every = s => s.reachable && !!segInfoMap.get(s.id) && segInfoMap.get(s.id).calledInEveryPaths;
	const seen = s => segInfoMap.has(s.id);
	return {
		step(step) {
			switch (step.k) {
				case "start": {
					current.add(step.segment);
					const i = { calledInEveryPaths: false, calledInSomePaths: false, validNodes: [] };
					segInfoMap.set(step.segment.id, i);
					const prev = step.segment.prevSegments.filter(seen);
					if (prev.length > 0) {
						i.calledInSomePaths = prev.some(some);
						i.calledInEveryPaths = prev.every(every);
					}
					if (step.forUpdate) i.calledInEveryPaths = true;
					break;
				}
				case "ustart": current.add(step.segment); break;
				case "end": case "uend": current.delete(step.segment); break;
				case "loop":
					info.codePath.traverseSegments({ first: step.to, last: step.from }, (segment, controller) => {
						const i = segInfoMap.get(segment.id);
						if (!i) { controller.skip(); return; }
						const prev = segment.prevSegments.filter(seen);
						const somePrev = prev.some(some);
						const everyPrev = prev.every(every);
						i.calledInSomePaths ||= somePrev;
						i.calledInEveryPaths ||= everyPrev;
						if (somePrev) {
							const nodes = i.validNodes;
							i.validNodes = [];
							for (const at of nodes) report("constructor-super", at, "Unexpected duplicate 'super()'.");
						}
					});
					break;
				case "super": {
					let duplicate = false, i = null;
					for (const s of current) {
						if (s.reachable) {
							i = segInfoMap.get(s.id);
							duplicate = duplicate || i.calledInSomePaths;
							i.calledInSomePaths = i.calledInEveryPaths = true;
						}
					}
					if (i) {
						if (duplicate) report("constructor-super", step.at, "Unexpected duplicate 'super()'.");
						else if (!info.superIsConstructor) report("constructor-super", step.at, "Unexpected 'super()' because 'super' is not a constructor.");
						else i.validNodes.push(step.at);
					}
					break;
				}
				case "return":
					for (const s of current) {
						if (s.reachable) {
							const i = segInfoMap.get(s.id);
							i.calledInSomePaths = i.calledInEveryPaths = true;
						}
					}
					break;
				default: break;
			}
		},
		end() {
			const returned = info.codePath.returnedSegments;
			if (!returned.every(every)) report("constructor-super", info.methodAt, returned.some(some) ? "Lacked a call of 'super()' in some code paths." : "Expected to call 'super()'.");
		},
	};
}

function noThisBeforeSuper(info, report) {
	const segInfoMap = new Map();
	const current = new Set();
	const isCalled = s => !s.reachable || !!(segInfoMap.get(s.id) && segInfoMap.get(s.id).superCalled);
	const isBefore = () => ![...current].every(isCalled);
	return {
		step(step) {
			if (!info.hasValidExtends) return;
			switch (step.k) {
				case "start": {
					current.add(step.segment);
					const prev = step.segment.prevSegments;
					segInfoMap.set(step.segment.id, { superCalled: prev.length > 0 && prev.every(isCalled), invalidNodes: [] });
					break;
				}
				case "ustart": current.add(step.segment); break;
				case "end": case "uend": current.delete(step.segment); break;
				case "loop":
					info.codePath.traverseSegments({ first: step.to, last: step.from }, (segment, controller) => {
						const i = segInfoMap.get(segment.id) || { superCalled: false, invalidNodes: [] };
						const prev = segment.prevSegments;
						if (i.superCalled) controller.skip();
						else if (prev.length > 0 && prev.every(isCalled)) i.superCalled = true;
						segInfoMap.set(segment.id, i);
					});
					break;
				case "this": case "superref":
					if (isBefore()) for (const s of current) if (s.reachable) segInfoMap.get(s.id).invalidNodes.push(step);
					break;
				case "super":
					if (isBefore()) for (const s of current) if (s.reachable) segInfoMap.get(s.id).superCalled = true;
					break;
				default: break;
			}
		},
		end() {
			if (!info.hasValidExtends) return;
			const reported = new Set();
			info.codePath.traverseSegments((segment, controller) => {
				const i = segInfoMap.get(segment.id);
				if (!i) { info.missing = true; return; }
				for (const step of i.invalidNodes) {
					if (reported.has(step)) continue;
					reported.add(step);
					report("no-this-before-super", step.at, `'${step.k === "this" ? "this" : "super"}' is not allowed before 'super()'.`);
				}
				if (i.superCalled) controller.skip();
			});
		},
	};
}

// ---------------------------------------------------------------------------------------------------------------
// The walk with the four rules.
// ---------------------------------------------------------------------------------------------------------------
function model(ast, source, options = {}) {
	const reports = [];
	const liveReports = [];
	const report = (rule, at, message) => reports.push({ rule, at, message });
	const held = [];
	const comments = ast.comments;
	const tokens = ast.tokens;

	// One entry per open code path.
	const stack = [];
	// Functions that are getters: node -> { name, at, global }. Filled from above.
	const getters = new Map();
	// Object literals that are property descriptors, and those whose property values are: node -> the global name.
	const descriptors = new Map();
	const descriptorMaps = new Map();
	// The functions that are constructors: node -> { klass, at }.
	const constructors = new Map();
	let notes = { liveDiffers: false };

	function getterName(p, f, inClass) {
		const words = [];
		if (inClass && p.is_static) words.push("static");
		if (inClass && !p.is_computed && p.key.t === "EPrivateIdentifier") words.push("private");
		if (f.is_async || (f.func && f.func.is_async)) words.push("async");
		if (f.func && f.func.is_generator) words.push("generator");
		words.push(p.kind === "get" ? "getter" : p.kind === "set" ? "setter" : "method");
		if (!p.is_computed && p.key.t === "EPrivateIdentifier") words.push(`#${p.key.src.name}`);
		else {
			const name = keyName(p);
			if (name !== null) words.push(`'${name}'`);
			else if (f.func && f.func.name) words.push(`'${f.func.name.name}'`);
		}
		return words.join(" ");
	}
	const markGetter = (f, p, inClass, global) => {
		if (!getters.has(f)) getters.set(f, { name: getterName(p, f, inClass), at: p.src.range[0], global });
	};

	const emit = (name, args) => {
		const top = stack.at(-1);
		switch (name) {
			case "onCodePathStart": {
				const [codePath, node] = args;
				const isFn = codePath.origin === "function";
				const ctor = isFn ? constructors.get(node) : null;
				const info = {
					codePath,
					current: new Set(),
					getter: isFn ? getters.get(node) || null : null,
					hasReturn: false,
					rec: ctor && ctor.klass.extends ? [] : null,
				};
				if (info.rec) {
					info.superIsConstructor = isPossibleConstructor(ctor.klass.extends);
					info.hasValidExtends = !isNullOrUndefined(ctor.klass.extends);
					info.methodAt = ctor.at;
					if (options.live) {
						const r = (rule, at, message) => liveReports.push({ rule, at, message });
						info.live = [constructorSuper(info, r), noThisBeforeSuper(info, r)];
					}
				}
				stack.push(info);
				break;
			}
			case "onCodePathEnd": {
				const info = stack.pop();
				if (info.rec) {
					for (const machine of [constructorSuper(info, report), noThisBeforeSuper(info, report)]) {
						for (const step of info.rec) machine.step(step);
						machine.end();
					}
					if (info.live) for (const machine of info.live) machine.end();
				}
				break;
			}
			case "onCodePathSegmentStart":
				top.current.add(args[0]);
				if (top.rec) push(top, { k: "start", segment: args[0], forUpdate: !!(args[1] && args[1].isForUpdate) });
				break;
			case "onUnreachableCodePathSegmentStart":
				top.current.add(args[0]);
				if (top.rec) push(top, { k: "ustart", segment: args[0] });
				break;
			case "onCodePathSegmentEnd":
				top.current.delete(args[0]);
				if (top.rec) push(top, { k: "end", segment: args[0] });
				break;
			case "onUnreachableCodePathSegmentEnd":
				top.current.delete(args[0]);
				if (top.rec) push(top, { k: "uend", segment: args[0] });
				break;
			case "onCodePathSegmentLoop":
				if (top.rec) push(top, { k: "loop", from: args[0], to: args[1] });
				break;
			default: break;
		}
	};
	function push(info, step) {
		info.rec.push(step);
		if (info.live) for (const machine of info.live) machine.step(step);
	}

	// no-fallthrough: the open `switch` statements.
	const switches = [];
	const lastCommentBefore = at => {
		// The comments between the token before `at` and `at`: the last one.
		let lo = 0, hi = tokens.length;
		while (lo < hi) { const mid = (lo + hi) >> 1; if (tokens[mid].range[0] < at) lo = mid + 1; else hi = mid; }
		const prevEnd = lo > 0 ? tokens[lo - 1].range[1] : 0;
		let last = null;
		for (const c of comments) if (c.range[0] >= prevEnd && c.range[1] <= at) last = c;
		return last;
	};
	const isFallThroughComment = c => /falls?\s?through/iu.test(c.value) && !/^(eslint(?:-env|-enable|-disable(?:(?:-next)?-line)?)?|exported|globals?)(?:\s|$)/u.test(c.value.trim());

	const probe = (when, node) => {
		const top = stack.at(-1);
		if (when === "enter") {
			switch (node.t) {
				case "EObject": {
					if (node.is_target) break;
					const descriptorOf = descriptors.get(node);
					const mapOf = descriptorMaps.get(node);
					for (const p of node.properties) {
						if (p.kind === "spread") continue;
						if (p.kind === "get") {
							markGetter(p.value, p, false, null);
							// `parent.kind === "get"` holds for the key too.
							if (p.is_computed && isFunction(p.key)) markGetter(p.key, p, false, null);
						} else if (descriptorOf !== undefined && keyName(p) === "get" && isFunction(p.value)) {
							markGetter(p.value, p, false, descriptorOf);
						}
						if (mapOf !== undefined && p.value && p.value.t === "EObject" && !p.value.is_target && !p.was_shorthand) descriptors.set(p.value, mapOf);
					}
					break;
				}
				case "MethodDefinition": {
					const p = node.property;
					if (p.kind === "get") {
						markGetter(p.value, p, true, null);
						if (p.is_computed && isFunction(p.key)) markGetter(p.key, p, true, null);
					}
					if (p.is_constructor) constructors.set(p.value, { klass: node.klass, at: p.src.range[0] });
					break;
				}
				case "ECall": {
					const t = node.target;
					let object = null, property = null;
					if (t.t === "EDot" && t.target.t === "EIdentifier") { object = t.target.name; property = t.name; }
					else if (t.t === "EIndex" && t.target.t === "EIdentifier" && t.index.t !== "EPrivateIdentifier") { object = t.target.name; property = staticString(t.index); }
					if ((object === "Object" || object === "Reflect") && property === "defineProperty") {
						const a = node.args[2];
						if (a && a.t === "EObject") descriptors.set(a, object);
					} else if (object === "Object" && (property === "create" || property === "defineProperties")) {
						const a = node.args[1];
						if (a && a.t === "EObject") descriptorMaps.set(a, object);
					}
					break;
				}
				case "SReturn":
					if (top.getter) {
						top.hasReturn = true;
						if (!node.value) (top.getter.global ? held : reports).push({ rule: "getter-return", at: node.at, message: `Expected to return a value in ${top.getter.name}.`, global: top.getter.global });
					}
					if (top.rec && node.value) push(top, { k: "return" });
					break;
				case "EThis":
					if (top.rec) push(top, { k: "this", at: node.at });
					break;
				case "ESuper":
					if (top.rec && !node.isCallee) push(top, { k: "superref", at: node.at });
					break;
				case "SSwitch":
					switches.push({ node, previous: null });
					break;
				case "SwitchCase": {
					const sw = switches.at(-1);
					const previous = sw.previous;
					if (previous && previous.isFallthrough) {
						let comment = null;
						const body = previous.case.body;
						if (body.length === 1 && body[0].t === "SBlock") {
							const c = lastCommentBefore(body[0].src.range[1] - 1);
							if (c && isFallThroughComment(c)) comment = c;
						}
						if (!comment) {
							const c = lastCommentBefore(node.src.range[0]);
							if (c && isFallThroughComment(c)) comment = c;
						}
						if (!comment) report("no-fallthrough", node.src.range[0], `Expected a 'break' statement before '${node.case.value ? "case" : "default"}'.`);
					}
					sw.previous = null;
					break;
				}
				default: break;
			}
		} else {
			switch (node.t) {
				case "EFunction": case "EArrow":
					if (top.getter && [...top.current].some(s => s.reachable)) {
						(top.getter.global ? held : reports).push({
							rule: "getter-return", at: top.getter.at, global: top.getter.global,
							message: top.hasReturn ? `Expected ${top.getter.name} to always return a value.` : `Expected to return a value in ${top.getter.name}.`,
						});
					}
					break;
				case "ECall":
					if (top.rec && node.target.t === "ESuper") push(top, { k: "super", at: node.at });
					break;
				case "SwitchCase": {
					const sw = switches.at(-1);
					const cases = sw.node.cases;
					const reachable = [...top.current].some(s => s.reachable);
					let isFallthrough = false;
					if (reachable && cases.at(-1) !== node.case) {
						if (node.case.body.length > 0) isFallthrough = true;
						else {
							// The `:` of the clause is its last token; the next token is the `case` or `default` after it.
							const next = cases[cases.indexOf(node.case) + 1];
							isFallthrough = lineOf(source, next.src.range[0]) > lineOf(source, node.src.range[1] - 1) + 1;
						}
					}
					sw.previous = { case: node.case, isFallthrough };
					break;
				}
				case "SSwitch":
					switches.pop();
					break;
				default: break;
			}
		}
	};
	const driver = new Driver(emit, probe, {});
	driver.program(bunshape.program(ast));
	return { reports, held, liveReports, notes };
}

// ---------------------------------------------------------------------------------------------------------------
// The harness.
// ---------------------------------------------------------------------------------------------------------------
function lineColumn(source, offset) {
	let line = 1, last = -1;
	for (let i = 0; i < offset; i++) {
		const c = source.charCodeAt(i);
		if (c === 10 || c === 0x2028 || c === 0x2029 || (c === 13 && source.charCodeAt(i + 1) !== 10)) { line++; last = i; }
	}
	return `${line}:${offset - last}`;
}

const linter = new Linter({ configType: "flat" });
function run(source, options) {
	let first = null;
	for (const sourceType of options.sourceType ? [options.sourceType] : ["script", "module", "commonjs"]) {
		let ast = null, scopeManager = null, sourceCode = null;
		const grab = { create: context => ({ Program(node) { ast = node; sourceCode = context.sourceCode; scopeManager = context.sourceCode.scopeManager; } }) };
		const languageOptions = { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx: !!options.jsx } } };
		const messages = linter.verify(source, [{ plugins: { t: { rules: { grab } } }, rules: { "t/grab": 2, ...Object.fromEntries(RULES.map(r => [r, 2])) }, languageOptions, linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" } }]);
		if (messages.some(m => m.fatal)) { first = first || { fatal: messages.find(m => m.fatal).message }; continue; }
		const expected = messages.filter(m => RULES.includes(m.ruleId)).map(m => `${m.ruleId} ${m.line}:${m.column} ${m.message}`).sort();
		ast.tokens = sourceCode.ast.tokens;
		ast.comments = sourceCode.ast.comments;
		let m;
		try {
			m = model(ast, source, options);
		} catch (e) {
			return { expected, failed: e.stack.split("\n").slice(0, 5).join(" | ") };
		}
		// A report that depends on a global: ESLint asks whether the name is the global one there.
		const declared = new Set();
		for (const scope of scopeManager.scopes) for (const variable of scope.variables) if (variable.defs.length > 0) declared.add(variable.name);
		const planned = m.reports.concat(m.held.filter(h => !declared.has(h.global)));
		const fmt = list => list.map(r => `${r.rule} ${lineColumn(source, r.at)} ${r.message}`).sort();
		const once = list => list.filter((x, i) => i === 0 || list[i - 1] !== x);
		return { expected, actual: once(fmt(planned)), heldDropped: m.held.some(h => declared.has(h.global)), live: options.live ? once(fmt(m.liveReports)) : null, actualCtor: once(fmt(m.reports.filter(r => r.rule === "constructor-super" || r.rule === "no-this-before-super"))) };
	}
	return first;
}

function main() {
	const args = process.argv.slice(2);
	const sources = [];
	const options = { live: false };
	let show = false;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--upstream") {
			for (const rule of RULES) for (const c of JSON.parse(fs.readFileSync(path.join(__dirname, "cases", `upstream-${rule}.raw.json`), "utf8")).cases) sources.push({ code: c.code, jsx: c.ext === "jsx", sourceType: c.sourceType, ext: c.ext });
		} else if (args[i] === "--list") {
			const raw = JSON.parse(fs.readFileSync(args[++i], "utf8"));
			for (const c of Array.isArray(raw) ? raw : raw.cases) sources.push(typeof c === "string" ? { code: c, ext: "js" } : { code: c.code, jsx: c.ext === "jsx" || c.jsx, sourceType: c.sourceType, ext: c.ext || "js" });
		} else if (args[i] === "--files") {
			for (const f of fs.readFileSync(args[++i], "utf8").split("\n").filter(Boolean)) { try { sources.push({ code: fs.readFileSync(f, "utf8"), name: f, jsx: f.endsWith("x"), ext: "js" }); } catch {} }
		} else if (args[i] === "--live") options.live = true;
		else if (args[i] === "--show") show = true;
	}
	const count = { sources: 0, rejected: 0, same: 0, different: 0, failed: 0, reports: 0, heldDropped: 0, liveDiffers: 0, skippedTs: 0 };
	const perRule = {};
	for (const s of sources) {
		if (s.ext && /^[mc]?ts/u.test(s.ext)) { count.skippedTs++; continue; }
		count.sources++;
		const r = run(s.code, { ...options, jsx: s.jsx, sourceType: s.sourceType });
		if (!r || r.fatal) { count.rejected++; continue; }
		if (r.failed) { count.failed++; console.log("FAILED", JSON.stringify((s.name || s.code).slice(0, 200)), r.failed); continue; }
		count.reports += r.expected.length;
		for (const e of r.expected) { const rule = e.split(" ")[0]; perRule[rule] = (perRule[rule] || 0) + 1; }
		if (r.heldDropped) count.heldDropped++;
		if (JSON.stringify(r.expected) === JSON.stringify(r.actual)) count.same++;
		else {
			count.different++;
			if (show || count.different <= 20) console.log(`DIFFERENT ${JSON.stringify((s.name || s.code).slice(0, 300))}\n   eslint ${r.expected.join(" | ") || "(none)"}\n   model  ${r.actual.join(" | ") || "(none)"}`);
		}
		if (r.live && JSON.stringify(r.live) !== JSON.stringify(r.actualCtor)) {
			count.liveDiffers++;
			if (show || count.liveDiffers <= 10) console.log(`LIVE DIFFERS ${JSON.stringify((s.name || s.code).slice(0, 300))}\n   replay ${r.actualCtor.join(" | ") || "(none)"}\n   live   ${r.live.join(" | ") || "(none)"}`);
		}
	}
	console.log(JSON.stringify(count), JSON.stringify(perRule));
}
if (require.main === module) main();
module.exports = { model, run, RULES };
