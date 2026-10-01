// Research scratch (rules-code-path, pass 1b, top-down): getter-return, no-fallthrough, constructor-super and
// no-this-before-super as the port plans them, on a tree of Bun's shape (../code-path-analysis/proto/bunshape.cjs)
// driven by ../code-path-analysis/proto/driver.cjs, against ESLint's own four rules at the pin.
//   - which function is a getter or a constructor is decided from above (the class, the object literal, the call mark the
//     function nodes below them); no parent pointer is read;
//   - getter-return and no-fallthrough run live, in the walk;
//   - constructor-super and no-this-before-super record the steps of a constructor of a derived class and replay them
//     when its code path ends, on the graph as it is then (mode "deferred"); mode "live" runs the same text at once;
//   - a report that depends on `Object` or `Reflect` being the global is dropped when the file declares the name anywhere.
// usage: node model.cjs [--mode deferred|live] [--exact-globals] [--cases corpus.json]... [--list cases.json]... [--files list.txt]
//                       [--upstream] [--show n] [--rules a,b]
"use strict";
const fs = require("fs");
const path = require("path");
const ESLINT = "/workspace/ref/eslint";
const { Linter } = require(path.join(ESLINT, "lib/linter"));
const astUtils = require(path.join(ESLINT, "lib/rules/utils/ast-utils"));
const bunshape = require("../code-path-analysis/proto/bunshape.cjs");
const { Driver } = require("../code-path-analysis/proto/driver.cjs");
const CodePath = require(path.join(ESLINT, "lib/linter/code-path-analysis/code-path"));

const ALL = ["getter-return", "no-fallthrough", "constructor-super", "no-this-before-super"];

// ---------------------------------------------------------------------------------------------------------------
// Helpers on Bun's shape.
// ---------------------------------------------------------------------------------------------------------------
const isLink = e => e.t === "EDot" || e.t === "EIndex";

// `getStaticStringValue` of a key or of an index.
function staticString(e) {
	switch (e.t) {
		case "EString":
			return e.value;
		case "ENumber":
			return String(e.value);
		case "EBigInt":
			return e.value;
		case "EBoolean":
			return String(e.value);
		case "ENull":
			return "null";
		default:
			return null;
	}
}
// `getStaticPropertyName` of a property of an object literal or of a class.
function staticKeyName(p) {
	if (!p.key || p.key.t === "EPrivateIdentifier") return null;
	return staticString(p.key);
}
// `getStaticPropertyName` of a member.
function staticMemberName(e) {
	if (e.t === "EDot") return e.name;
	if (e.t === "EIndex" && e.index.t !== "EPrivateIdentifier") return staticString(e.index);
	return null;
}
// What `isConstructorFunction` asks of the member above a function: Bun's parser makes exactly this the constructor.
function isConstructorMember(p) {
	return !!p.is_method && p.kind === "normal" && !p.is_static && !p.is_computed && p.key.t === "EString" && p.key.value === "constructor";
}
// `isPossibleConstructor`.
function isPossibleConstructor(e) {
	if (!e) return false;
	switch (e.t) {
		case "EClass":
		case "EFunction":
		case "EThis":
		case "EDot":
		case "EIndex":
		case "ECall":
		case "ENew":
		case "EYield":
		case "ENewTarget":
		case "EImportMeta":
			return true;
		case "ETemplate":
			return e.tag !== null;
		case "EIdentifier":
			return e.name !== "undefined";
		case "EBinary":
			switch (e.op) {
				case "=":
				case "&&=":
				case "&&":
				case ",":
					return isPossibleConstructor(e.right);
				case "||=":
				case "??=":
				case "||":
				case "??":
					return isPossibleConstructor(e.left) || isPossibleConstructor(e.right);
				default:
					return false;
			}
		case "EIf":
			return isPossibleConstructor(e.no) || isPossibleConstructor(e.yes);
		default:
			return false;
	}
}
// `isNullOrUndefined`.
function isNullOrUndefined(e) {
	return e.t === "ENull" || (e.t === "EIdentifier" && e.name === "undefined") || (e.t === "EUnary" && e.op === "void");
}
// `getFunctionNameWithKind` of a function that is the value of a member of a class or of a property of an object.
function functionNameWithKind(mark, f) {
	const p = mark.property;
	const tokens = [];
	const isPrivate = !p.is_computed && p.key.t === "EPrivateIdentifier";
	if (mark.inClass) {
		if (p.is_static) tokens.push("static");
		if (isPrivate) tokens.push("private");
	}
	const fn = f.t === "EFunction" ? f.func : f;
	if (fn.is_async) tokens.push("async");
	if (fn.is_generator) tokens.push("generator");
	if (mark.inClass && isConstructorMember(p)) return "constructor";
	tokens.push(p.kind === "get" ? "getter" : p.kind === "set" ? "setter" : "method");
	if (isPrivate) tokens.push(`#${p.key.src.name}`);
	else {
		// The model takes the spelling of a static name from ESLint: the port has ast_utils::get_static_string_value for it.
		const name = astUtils.getStaticPropertyName(p.src);
		if (name !== null) tokens.push(`'${name}'`);
		else if (fn.name) tokens.push(`'${fn.name.name}'`);
	}
	return tokens.join(" ");
}

// The comments in text that stands between two tokens: blanks and comments only.
function triviaComments(text) {
	const out = [];
	let i = 0;
	while (i < text.length) {
		if (text.startsWith("//", i)) {
			let j = i + 2;
			while (j < text.length && !/[\n\r\u2028\u2029]/u.test(text[j])) j++;
			out.push(text.slice(i + 2, j));
			i = j;
		} else if (text.startsWith("/*", i)) {
			const j = text.indexOf("*/", i + 2);
			if (j < 0) break;
			out.push(text.slice(i + 2, j));
			i = j + 2;
		} else i++;
	}
	return out;
}
const FALLTHROUGH = /falls?\s?through/iu;
const DIRECTIVE = /^(eslint(?:-env|-enable|-disable(?:(?:-next)?-line)?)?|exported|globals?)(?:\s|$)/u;
const isFallThroughComment = value => FALLTHROUGH.test(value) && !DIRECTIVE.test(value.trim());

// ---------------------------------------------------------------------------------------------------------------
// The rules.
// ---------------------------------------------------------------------------------------------------------------
function makeRules(sourceCode, text, options) {
	const reports = [];
	const held = [];
	const at = offset => {
		const loc = sourceCode.getLocFromIndex(offset);
		return `${loc.line}:${loc.column + 1}`;
	};
	const report = (rule, offset, message, mark) => {
		const line = `${rule} ${at(offset)} ${message}`;
		if (mark && mark.names) held.push([mark, line]);
		else reports.push(line);
	};
	const anyReachable = list => list.some(s => s.reachable);
	// Whether the list of the analyzer says what the set of the rule says: the port can then ask the analyzer alone.
	const sameAsState = info => {
		if (!options.stats) return;
		options.stats.stateChecks++;
		const state = CodePath.getState(info.codePath).currentSegments;
		if (anyReachable(state) !== anyReachable(info.current)) options.stats.stateDiffers++;
		if (state.length !== info.current.length || state.some(x => !info.current.includes(x))) options.stats.stateOtherSet++;
	};

	// function node -> { names: null | global name, id, property, inClass }
	const getters = new Map();
	// function node -> { klass, property }
	const constructors = new Map();

	function descriptor(object, names, id) {
		for (const p of object.properties) {
			if (p.kind === "spread" || p.was_shorthand) continue;
			if (staticKeyName(p) !== "get") continue;
			const f = p.value;
			if (f && (f.t === "EFunction" || (f.t === "EArrow" && !f.prefer_expr)) && !getters.has(f)) getters.set(f, { names, id, property: p, inClass: false });
		}
	}

	// One entry per open code path.
	const paths = [];
	const top = () => paths.at(-1);
	const stats = options.stats;

	// ---- constructor-super: the text of the rule, on segments.
	function constructorSuper(info) {
		const seg = new Map();
		const current = [];
		const some = s => s.reachable && seg.get(s).some;
		const every = s => s.reachable && seg.get(s).every;
		const seen = s => seg.has(s);
		return {
			start(s, isForUpdate) {
				if (!current.includes(s)) current.push(s);
				const i = { every: false, some: false, valid: [] };
				seg.set(s, i);
				const prev = s.prevSegments.filter(seen);
				if (prev.length > 0) {
					i.some = prev.some(some);
					i.every = prev.every(every);
				}
				if (isForUpdate) i.every = true;
			},
			ustart(s) {
				if (!current.includes(s)) current.push(s);
			},
			end(s) {
				const k = current.indexOf(s);
				if (k >= 0) current.splice(k, 1);
			},
			loop(from, to) {
				info.codePath.traverseSegments({ first: to, last: from }, (s, controller) => {
					const i = seg.get(s);
					if (!i) {
						controller.skip();
						return;
					}
					const prev = s.prevSegments.filter(seen);
					const somePrev = prev.some(some);
					const everyPrev = prev.every(every);
					i.some ||= somePrev;
					i.every ||= everyPrev;
					if (somePrev) {
						const nodes = i.valid;
						i.valid = [];
						for (const n of nodes) report("constructor-super", n.src.range[0], "Unexpected duplicate 'super()'.");
					}
				});
			},
			superCall(node) {
				let duplicate = false;
				let i = null;
				for (const s of current) {
					if (s.reachable) {
						i = seg.get(s);
						duplicate = duplicate || i.some;
						i.some = i.every = true;
					}
				}
				if (i) {
					if (duplicate) report("constructor-super", node.src.range[0], "Unexpected duplicate 'super()'.");
					else if (!info.superIsConstructor) report("constructor-super", node.src.range[0], "Unexpected 'super()' because 'super' is not a constructor.");
					else i.valid.push(node);
				}
			},
			returnWithArgument() {
				for (const s of current) {
					if (s.reachable) {
						const i = seg.get(s);
						i.some = i.every = true;
					}
				}
			},
			finish() {
				const returned = info.codePath.returnedSegments;
				if (!returned.every(every)) {
					report("constructor-super", info.mark.property.src.range[0], returned.some(some) ? "Lacked a call of 'super()' in some code paths." : "Expected to call 'super()'.");
				}
			},
		};
	}

	// ---- no-this-before-super.
	function noThisBeforeSuper(info) {
		const seg = new Map();
		const current = [];
		const called = s => !s.reachable || (seg.has(s) && seg.get(s).superCalled);
		const before = () => !current.every(called);
		const invalid = node => {
			for (const s of current) if (s.reachable) seg.get(s).invalid.push(node);
		};
		return {
			start(s) {
				if (!current.includes(s)) current.push(s);
				seg.set(s, { superCalled: s.prevSegments.length > 0 && s.prevSegments.every(called), invalid: [] });
			},
			ustart(s) {
				if (!current.includes(s)) current.push(s);
			},
			end(s) {
				const k = current.indexOf(s);
				if (k >= 0) current.splice(k, 1);
			},
			loop(from, to) {
				info.codePath.traverseSegments({ first: to, last: from }, (s, controller) => {
					if (!seg.has(s) && stats) stats.loopMadeInfo++;
					const i = seg.get(s) ?? { superCalled: false, invalid: [] };
					if (i.superCalled) controller.skip();
					else if (s.prevSegments.length > 0 && s.prevSegments.every(called)) i.superCalled = true;
					seg.set(s, i);
				});
			},
			thisOrSuper(node) {
				if (before()) invalid(node);
			},
			superCall() {
				if (before()) for (const s of current) if (s.reachable) seg.get(s).superCalled = true;
			},
			finish() {
				const reported = new Set();
				info.codePath.traverseSegments((s, controller) => {
					const i = seg.get(s);
					for (const n of i.invalid) {
						if (reported.has(n)) continue;
						reported.add(n);
						report("no-this-before-super", n.src.range[0], `'${n.t === "ESuper" ? "super" : "this"}' is not allowed before 'super()'.`);
					}
					if (i.superCalled) controller.skip();
				});
			},
		};
	}

	// A step of a constructor of a derived class goes to the two rules: at once, or when the path ends.
	function feed(info, step) {
		if (options.mode === "live") apply(info, step);
		else info.steps.push(step);
	}
	function apply(info, [name, a, b]) {
		for (const rule of [info.cs, info.ntbs]) {
			if (!rule) continue;
			switch (name) {
				case "start":
					rule.start(a, b);
					break;
				case "ustart":
					rule.ustart(a);
					break;
				case "end":
					rule.end(a);
					break;
				case "loop":
					rule.loop(a, b);
					break;
				case "superCall":
					rule.superCall(a);
					break;
				case "return":
					if (rule === info.cs) rule.returnWithArgument();
					break;
				case "this":
					if (rule === info.ntbs) rule.thisOrSuper(a);
					break;
				default:
					throw new Error(name);
			}
		}
	}

	return {
		reports,
		event(name, [a, b]) {
			switch (name) {
				case "onCodePathStart": {
					const node = b;
					const isFunction = a.origin === "function";
					const getter = isFunction ? getters.get(node) : undefined;
					const ctor = isFunction ? constructors.get(node) : undefined;
					const info = { codePath: a, node, getter, shouldCheck: !!getter, hasReturn: false, current: [], steps: [], cs: null, ntbs: null, mark: ctor };
					if (ctor) {
						const superClass = ctor.klass.extends;
						info.superIsConstructor = isPossibleConstructor(superClass);
						if (superClass) info.cs = constructorSuper(info);
						if (superClass && !isNullOrUndefined(superClass)) info.ntbs = noThisBeforeSuper(info);
					}
					info.derived = !!(info.cs || info.ntbs);
					if (stats) {
						stats.paths++;
						if (info.derived) stats.derivedConstructors++;
					}
					paths.push(info);
					break;
				}
				case "onCodePathEnd": {
					const info = paths.pop();
					if (info.derived) {
						if (stats) {
							stats.steps += info.steps.length;
							stats.maxSteps = Math.max(stats.maxSteps, info.steps.length);
						}
						if (options.mode !== "live") for (const step of info.steps) apply(info, step);
						if (info.cs) info.cs.finish();
						if (info.ntbs) info.ntbs.finish();
					}
					break;
				}
				case "onCodePathSegmentStart":
					if (!top().current.includes(a)) top().current.push(a);
					if (top().derived) feed(top(), ["start", a, !!(b && b.isForUpdate)]);
					break;
				case "onUnreachableCodePathSegmentStart":
					if (!top().current.includes(a)) top().current.push(a);
					if (top().derived) feed(top(), ["ustart", a]);
					break;
				case "onCodePathSegmentEnd":
				case "onUnreachableCodePathSegmentEnd": {
					const k = top().current.indexOf(a);
					if (k >= 0) top().current.splice(k, 1);
					if (top().derived) feed(top(), ["end", a]);
					break;
				}
				case "onCodePathSegmentLoop":
					if (top().derived) feed(top(), ["loop", a, b]);
					break;
				default:
					throw new Error(name);
			}
		},
		node(when, node) {
			if (when === "enter") {
				switch (node.t) {
					case "EObject":
						if (node.is_target) break;
						for (const p of node.properties) {
							if (p.kind === "get" && p.value && p.value.t === "EFunction") getters.set(p.value, { names: null, property: p, inClass: false });
						}
						break;
					case "SClass":
					case "EClass":
						for (const p of node.class.properties) {
							if (!p.is_method) continue;
							if (p.kind === "get") getters.set(p.value, { names: null, property: p, inClass: true });
							if (isConstructorMember(p)) constructors.set(p.value, { klass: node.class, property: p });
						}
						break;
					case "ECall": {
						const callee = node.target;
						if (!isLink(callee) || callee.target.t !== "EIdentifier") break;
						const object = callee.target.name;
						const property = staticMemberName(callee);
						if ((object === "Object" || object === "Reflect") && property === "defineProperty") {
							const arg = node.args[2];
							if (arg && arg.t === "EObject") descriptor(arg, object, callee.target);
						} else if (object === "Object" && (property === "create" || property === "defineProperties")) {
							const arg = node.args[1];
							if (arg && arg.t === "EObject") {
								for (const p of arg.properties) {
									if (p.kind !== "spread" && !p.was_shorthand && p.value && p.value.t === "EObject") descriptor(p.value, object, callee.target);
								}
							}
						}
						break;
					}
					case "SSwitch":
						node.cases.forEach((c, i) => {
							c.index = i;
							c.parentSwitch = node;
						});
						node.previousCase = null;
						break;
					case "SReturn": {
						const info = top();
						if (info.shouldCheck) {
							info.hasReturn = true;
							if (!node.value) report("getter-return", node.src.range[0], `Expected to return a value in ${functionNameWithKind(info.getter, info.node)}.`, info.getter);
						}
						if (info.cs && node.value) feed(info, ["return"]);
						break;
					}
					case "EThis":
						if (top().ntbs) feed(top(), ["this", node]);
						break;
					case "ESuper":
						if (top().ntbs && !node.isCallee) feed(top(), ["this", node]);
						break;
					case "SwitchCase": {
						const c = node.case;
						const s = c.parentSwitch;
						const previous = s.previousCase;
						if (previous && previous.isFallthrough) {
							// The comments that stand right before a token: the text between it and the token before it.
							const before = token => triviaComments(text.slice(sourceCode.getTokenBefore(token).range[1], token.range[0]));
							let comment = null;
							const body = previous.case.body;
							if (body.length === 1 && body[0].t === "SBlock") {
								const last = before(sourceCode.getLastToken(body[0].src)).pop();
								if (last !== undefined && isFallThroughComment(last)) comment = last;
							}
							if (comment === null) {
								const last = before(sourceCode.getFirstToken(c.src)).pop();
								if (last !== undefined && isFallThroughComment(last)) comment = last;
							}
							if (comment === null) report("no-fallthrough", c.src.range[0], c.value ? "Expected a 'break' statement before 'case'." : "Expected a 'break' statement before 'default'.");
						}
						s.previousCase = null;
						break;
					}
					default:
						break;
				}
				return;
			}
			switch (node.t) {
				case "EFunction":
				case "EArrow": {
					const info = top();
					sameAsState(info);
					if (info.shouldCheck && anyReachable(info.current)) {
						const name = functionNameWithKind(info.getter, info.node);
						report("getter-return", info.getter.property.src.range[0], info.hasReturn ? `Expected ${name} to always return a value.` : `Expected to return a value in ${name}.`, info.getter);
					}
					break;
				}
				case "ECall":
					if (node.target.t === "ESuper" && top().derived) feed(top(), ["superCall", node]);
					break;
				case "SwitchCase": {
					const c = node.case;
					const s = c.parentSwitch;
					const isLast = c.index === s.cases.length - 1;
					sameAsState(top());
					const reachable = anyReachable(top().current);
					let isFallthrough = false;
					if (reachable && !isLast) {
						if (c.body.length > 0) isFallthrough = true;
						else {
							// The clause is its head alone: its `:` is the token before the next clause.
							const next = sourceCode.getFirstToken(s.cases[c.index + 1].src);
							const colon = sourceCode.getTokenBefore(next);
							isFallthrough = next.loc.start.line > colon.loc.end.line + 1;
						}
					}
					s.previousCase = { case: c, isFallthrough };
					break;
				}
				default:
					break;
			}
		},
		finish(declared, isGlobalReference) {
			for (const [mark, line] of held) {
				const holds = options.exactGlobals ? isGlobalReference(mark.id.src) : !declared.has(mark.names);
				if (holds) reports.push(line);
			}
		},
	};
}

// ---------------------------------------------------------------------------------------------------------------
// The harness.
// ---------------------------------------------------------------------------------------------------------------
const linter = new Linter({ configType: "flat" });

function real(code, jsx, sourceType, ruleNames) {
	let captured = null;
	const capture = { create: context => ({ Program(node) { captured = { ast: node, sourceCode: context.sourceCode }; } }) };
	const config = [{
		files: ["**/*.{js,jsx,mjs,cjs}"],
		plugins: { t: { rules: { capture } } },
		languageOptions: { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx } } },
		linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" },
		rules: { "t/capture": 2, ...Object.fromEntries(ruleNames.map(r => [r, 2])) },
	}];
	let messages;
	try {
		messages = linter.verify(code, config, { filename: jsx ? "c.jsx" : "c.js" });
	} catch (e) {
		return { fatal: String(e) };
	}
	const fatal = messages.find(m => m.fatal);
	if (fatal) return { fatal: fatal.message };
	return { reports: messages.filter(m => m.ruleId && m.ruleId !== "t/capture").map(m => `${m.ruleId} ${m.line}:${m.column} ${m.message}`), ...captured };
}

function modelled(r, text, options, ruleNames) {
	const rules = makeRules(r.sourceCode, text, options);
	const driver = new Driver((name, args) => rules.event(name, args), (when, node) => rules.node(when, node), {});
	driver.program(bunshape.program(r.ast));
	bunshape.dropped.clear();
	const declared = new Set();
	for (const scope of r.sourceCode.scopeManager.scopes) for (const variable of scope.variables) if (variable.defs.length > 0) declared.add(variable.name);
	rules.finish(declared, id => r.sourceCode.isGlobalReference(id));
	return rules.reports.filter(line => ruleNames.includes(line.slice(0, line.indexOf(" "))));
}

function main() {
	const args = process.argv.slice(2);
	const sources = [];
	const options = { mode: "deferred", exactGlobals: false, stats: { paths: 0, derivedConstructors: 0, steps: 0, maxSteps: 0, loopMadeInfo: 0, stateChecks: 0, stateDiffers: 0, stateOtherSet: 0 } };
	let show = 20;
	let ruleNames = ALL;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--mode") options.mode = args[++i];
		else if (args[i] === "--exact-globals") options.exactGlobals = true;
		else if (args[i] === "--show") show = Number(args[++i]);
		else if (args[i] === "--rules") ruleNames = args[++i].split(",");
		else if (args[i] === "--cases") {
			for (const c of JSON.parse(fs.readFileSync(args[++i], "utf8"))) if (c.kind !== "ts") sources.push({ code: c.code, jsx: !!c.jsx, sourceType: c.sourceType });
		} else if (args[i] === "--list") {
			const raw = JSON.parse(fs.readFileSync(args[++i], "utf8"));
			for (const c0 of Array.isArray(raw) ? raw : raw.cases) {
				const c = typeof c0 === "string" ? { code: c0 } : c0;
				if (c.ext && /^[mc]?ts/u.test(c.ext)) continue;
				sources.push({ code: c.code, jsx: c.ext === "jsx" || !!c.jsx, sourceType: c.sourceType });
			}
		} else if (args[i] === "--files") {
			for (const f of fs.readFileSync(args[++i], "utf8").split("\n").filter(Boolean)) {
				try {
					const code = fs.readFileSync(f, "utf8");
					if (code.length < 2_000_000) sources.push({ code, jsx: f.endsWith("x"), name: f });
				} catch {}
			}
		} else if (args[i] === "--upstream") {
			for (const rule of ALL) for (const c of JSON.parse(fs.readFileSync(path.join(__dirname, `cases-upstream-${rule}.json`), "utf8")).cases) sources.push({ code: c.code, jsx: c.ext === "jsx", sourceType: c.sourceType });
		}
	}
	const count = { sources: sources.length, rejected: 0, failed: 0, same: 0, different: 0, reports: 0 };
	const perRule = Object.fromEntries(ruleNames.map(r => [r, 0]));
	for (const s of sources) {
		let r = null;
		const tries = s.sourceType ? [s.sourceType] : ["module", "commonjs", "script"];
		for (const t of tries) {
			r = real(s.code, s.jsx, t, ruleNames);
			if (!r.fatal) break;
		}
		if (r.fatal || !r.ast) {
			count.rejected++;
			continue;
		}
		let got;
		try {
			got = modelled(r, r.sourceCode.text, options, ruleNames);
		} catch (e) {
			count.failed++;
			bunshape.dropped.clear();
			if (count.failed <= show) console.log(`FAILED ${JSON.stringify((s.name || s.code).slice(0, 200))} ${e.stack.split("\n").slice(0, 3).join(" | ")}`);
			continue;
		}
		const want = r.reports.slice().sort();
		got = got.slice().sort();
		count.reports += want.length;
		for (const line of want) perRule[line.slice(0, line.indexOf(" "))]++;
		if (JSON.stringify(want) === JSON.stringify(got)) count.same++;
		else {
			count.different++;
			if (count.different <= show) {
				console.log(`DIFFERENT ${JSON.stringify((s.name || s.code).slice(0, 300))}`);
				for (const line of want) if (!got.includes(line)) console.log(`   eslint only: ${line}`);
				for (const line of got) if (!want.includes(line)) console.log(`   model only:  ${line}`);
			}
		}
	}
	console.log(JSON.stringify({ mode: options.mode, exactGlobals: options.exactGlobals, ...count, perRule, stats: options.stats }));
}
main();
