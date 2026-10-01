// PROTOTYPE of the research: five of the six rules the way the Rust modules are to do them, compared with ESLint at the pin.
// (no-dupe-else-if has its own prototype, proto-dupe-else-if.cjs.)
// The source is parsed by acorn with its parentheses kept and made into a tree of the shape of Bun's parse pass:
//   no ChainExpression (optional_chain Start / Continuation on the member or call), no parentheses node (a list of wrappers
//   beside the node, the innermost first), `a, b, c` as nested comma binaries, patterns on the left of `=` as literals,
//   a template without substitutions as a string that prefers a template, `loc` = the first OWN token of a node.
// The rules then run top-down over that tree: no parent pointer, no range, no end of a node.
// A name is global when the file declares it nowhere (the approximation of round 1, difference 10 of API.md).
// usage: node proto-bunshape.cjs [--show] <cases.json | answers.jsonl>...   every list is run for all five rules.
"use strict";
const path = require("path");
const fs = require("fs");
const eslintDir = "/workspace/ref/eslint";
const { Linter } = require(path.join(eslintDir, "lib/linter"));
const acorn = require(path.join(eslintDir, "node_modules/acorn"));
const jsx = require(path.join(eslintDir, "node_modules/acorn-jsx"));
const Parser = acorn.Parser.extend(jsx());
const linter = new Linter({ configType: "flat" });
const RULES = ["no-cond-assign", "no-constant-binary-expression", "no-constant-condition", "no-extra-boolean-cast", "no-unsafe-optional-chaining"];
const ECMASCRIPT_GLOBALS = new Set(Object.keys(require(path.join(eslintDir, "conf/globals.js")).es2026));

// ---------------------------------------------------------------------------------------------------------------------
// acorn -> the shape of Bun's tree
// ---------------------------------------------------------------------------------------------------------------------
function toBun(ast, declared) {
	const E = (tag, loc, rest) => ({ tag, loc, wrappers: [], ...rest });
	function pattern(n) {
		// A binding: B::Identifier, B::Array, B::Object.
		switch (n.type) {
			case "Identifier":
				declared.add(n.name);
				return { tag: "BIdentifier", loc: n.start };
			case "ArrayPattern":
				return {
					tag: "BArray",
					loc: n.start,
					items: n.elements.map(e => {
						if (!e) return { binding: { tag: "BMissing" }, default_value: null };
						if (e.type === "AssignmentPattern") return { binding: pattern(e.left), default_value: expr(e.right) };
						if (e.type === "RestElement") return { binding: pattern(e.argument), default_value: null };
						return { binding: pattern(e), default_value: null };
					}),
				};
			case "ObjectPattern":
				return {
					tag: "BObject",
					loc: n.start,
					properties: n.properties.map(p => {
						if (p.type === "RestElement") return { key: null, value: pattern(p.argument), default_value: null };
						const key = p.computed ? expr(p.key) : null;
						if (p.value.type === "AssignmentPattern") return { key, value: pattern(p.value.left), default_value: expr(p.value.right) };
						return { key, value: pattern(p.value), default_value: null };
					}),
				};
			default:
				throw new Error("binding " + n.type);
		}
	}
	// The left of an assignment and the head of for-in / for-of: Bun keeps the literal that it looks like.
	function target(n) {
		switch (n.type) {
			case "ArrayPattern":
				return E("EArray", n.start, { is_target: true, items: n.elements.map(e => (e ? target(e) : E("EMissing", n.start, {}))) });
			case "ObjectPattern":
				return E("EObject", n.start, {
					is_target: true,
					properties: n.properties.map(p => (p.type === "RestElement" ? { kind: "spread", value: target(p.argument) } : { key: p.computed ? expr(p.key) : null, value: target(p.value) })),
				});
			case "AssignmentPattern": {
				const left = target(n.left);
				return E("EBinary", left.loc, { op: "=", left, right: expr(n.right), is_default: true });
			}
			case "RestElement":
				return E("ESpread", n.start, { value: target(n.argument), is_rest: true });
			case "ParenthesizedExpression": {
				const inner = target(n.expression);
				inner.wrappers.push({ kind: "paren", op: n.start });
				return inner;
			}
			default:
				return expr(n);
		}
	}
	function args(params) {
		return params.map(p => {
			if (p.type === "AssignmentPattern") return { binding: pattern(p.left), default: expr(p.right) };
			if (p.type === "RestElement") return { binding: pattern(p.argument), default: null };
			return { binding: pattern(p), default: null };
		});
	}
	function fn(n) {
		if (n.id) declared.add(n.id.name);
		return { args: args(n.params), body: n.body.type === "BlockStatement" ? n.body.body.map(stmt) : [{ tag: "SReturn", value: expr(n.body) }] };
	}
	function klass(n) {
		if (n.id) declared.add(n.id.name);
		return {
			extends: n.superClass ? expr(n.superClass) : null,
			properties: n.body.body.map(m => {
				if (m.type === "StaticBlock") return { class_static_block: m.body.map(stmt) };
				return { key: m.computed ? expr(m.key) : null, value: m.value ? expr(m.value) : null };
			}),
		};
	}
	// `optional_chain` of the elements of one ChainExpression: Start at `?.`, Continuation above it.
	function chain(n, state) {
		if (n.type === "ParenthesizedExpression") return expr(n);
		if (n.type === "MemberExpression" || n.type === "CallExpression") {
			const below = n.type === "MemberExpression" ? n.object : n.callee;
			const inner = chain(below, state);
			let oc = null;
			if (n.optional) {
				oc = "Start";
				state.started = true;
			} else if (state.started) oc = "Continuation";
			return n.type === "MemberExpression" ? member(n, inner, oc) : call(n, inner, oc);
		}
		return expr(n);
	}
	function member(n, t, oc) {
		if (n.computed) return E("EIndex", t.loc, { target: t, index: expr(n.property), optional_chain: oc });
		if (n.property.type === "PrivateIdentifier") return E("EIndex", t.loc, { target: t, index: E("EPrivateIdentifier", n.property.start, {}), optional_chain: oc });
		return E("EDot", t.loc, { target: t, name: n.property.name, optional_chain: oc });
	}
	function call(n, t, oc) {
		return E("ECall", t.loc, { target: t, args: n.arguments.map(expr), optional_chain: oc });
	}
	function expr(n) {
		switch (n.type) {
			case "ParenthesizedExpression": {
				const inner = expr(n.expression);
				inner.wrappers.push({ kind: "paren", op: n.start });
				return inner;
			}
			case "Literal":
				if (n.regex) return E("ERegExp", n.start, {});
				if (n.bigint !== undefined) return E("EBigInt", n.start, { digits: n.raw.slice(0, -1).replace(/_/g, "") });
				if (n.value === null) return E("ENull", n.start, {});
				if (typeof n.value === "boolean") return E("EBoolean", n.start, { value: n.value });
				if (typeof n.value === "number") return E("ENumber", n.start, { value: n.value });
				return E("EString", n.start, { value: n.value, prefer_template: false });
			case "TemplateLiteral":
				if (n.expressions.length === 0) return E("EString", n.start, { value: n.quasis[0].value.cooked, prefer_template: true });
				return E("ETemplate", n.start, { tag_expr: null, head: n.quasis[0].value.cooked, parts: n.expressions.map((e, i) => ({ value: expr(e), tail: n.quasis[i + 1].value.cooked })) });
			case "TaggedTemplateExpression": {
				const tagExpr = expr(n.tag);
				return E("ETemplate", tagExpr.loc, { tag_expr: tagExpr, head: null, parts: n.quasi.expressions.map(e => ({ value: expr(e), tail: null })) });
			}
			case "Identifier":
				return E("EIdentifier", n.start, { name: n.name });
			case "PrivateIdentifier":
				return E("EPrivateIdentifier", n.start, {});
			case "ThisExpression":
				return E("EThis", n.start, {});
			case "Super":
				return E("ESuper", n.start, {});
			case "MetaProperty":
				return E(n.meta.name === "new" ? "ENewTarget" : "EImportMeta", n.start, {});
			case "ArrayExpression":
				return E("EArray", n.start, { items: n.elements.map(e => (e ? expr(e) : E("EMissing", n.start, {}))) });
			case "SpreadElement":
				return E("ESpread", n.start, { value: expr(n.argument) });
			case "ObjectExpression":
				return E("EObject", n.start, {
					properties: n.properties.map(p => (p.type === "SpreadElement" ? { kind: "spread", value: expr(p.argument) } : { key: p.computed ? expr(p.key) : null, value: expr(p.value) })),
				});
			case "FunctionExpression":
				return E("EFunction", n.start, { func: fn(n) });
			case "ArrowFunctionExpression":
				return E("EArrow", n.start, fn(n));
			case "ClassExpression":
				return E("EClass", n.start, klass(n));
			case "NewExpression":
				return E("ENew", n.start, { target: expr(n.callee), args: n.arguments.map(expr) });
			case "ChainExpression":
				return chain(n.expression, { started: false });
			case "CallExpression":
				return call(n, expr(n.callee), null);
			case "MemberExpression":
				return member(n, expr(n.object), null);
			case "ImportExpression":
				return E("EImport", n.start, { expr: expr(n.source) });
			case "UnaryExpression":
				return E("EUnary", n.start, { op: n.operator, value: expr(n.argument) });
			case "UpdateExpression": {
				const value = expr(n.argument);
				return E("EUnary", n.prefix ? n.start : value.loc, { op: (n.prefix ? "pre" : "post") + n.operator, value });
			}
			case "BinaryExpression":
			case "LogicalExpression": {
				const left = expr(n.left);
				return E("EBinary", left.loc, { op: n.operator, left, right: expr(n.right) });
			}
			case "AssignmentExpression": {
				const left = target(n.left);
				return E("EBinary", left.loc, { op: n.operator, left, right: expr(n.right) });
			}
			case "SequenceExpression": {
				let out = expr(n.expressions[0]);
				for (const e of n.expressions.slice(1)) out = E("EBinary", out.loc, { op: ",", left: out, right: expr(e) });
				return out;
			}
			case "ConditionalExpression": {
				const test = expr(n.test);
				return E("EIf", test.loc, { test, yes: expr(n.consequent), no: expr(n.alternate) });
			}
			case "AwaitExpression":
				return E("EAwait", n.start, { value: expr(n.argument) });
			case "YieldExpression":
				return E("EYield", n.start, { value: n.argument ? expr(n.argument) : null });
			case "JSXElement":
			case "JSXFragment": {
				const inside = [];
				(function collect(x) {
					if (!x || typeof x.type !== "string") return;
					if (x !== n && (x.type === "JSXElement" || x.type === "JSXFragment")) return void inside.push(expr(x));
					if (x.type === "JSXExpressionContainer") return void (x.expression.type !== "JSXEmptyExpression" && inside.push(expr(x.expression)));
					if (x.type === "JSXSpreadAttribute") return void inside.push(expr(x.argument));
					if (x.type === "JSXSpreadChild") return void inside.push(E("ESpread", x.start, { value: expr(x.expression) }));
					for (const k of Object.keys(x)) {
						const v = x[k];
						if (Array.isArray(v)) v.forEach(collect);
						else if (v && typeof v === "object" && k !== "loc") collect(v);
					}
				})(n);
				return E("EJsxElement", n.start, { children: inside });
			}
			default:
				throw new Error("expression " + n.type);
		}
	}
	function forHead(n) {
		if (n.type === "VariableDeclaration") return stmt(n);
		return { tag: "SExpr", value: target(n) };
	}
	function stmt(n) {
		switch (n.type) {
			case "ExpressionStatement":
				return { tag: "SExpr", loc: n.start, value: expr(n.expression) };
			case "BlockStatement":
				return { tag: "SBlock", loc: n.start, stmts: n.body.map(stmt) };
			case "StaticBlock":
				return { tag: "SBlock", loc: n.start, stmts: n.body.map(stmt) };
			case "EmptyStatement":
			case "DebuggerStatement":
			case "BreakStatement":
			case "ContinueStatement":
				return { tag: "SEmpty", loc: n.start };
			case "IfStatement":
				return { tag: "SIf", loc: n.start, test: expr(n.test), yes: stmt(n.consequent), no: n.alternate ? stmt(n.alternate) : null };
			case "WhileStatement":
				return { tag: "SWhile", loc: n.start, test: expr(n.test), body: stmt(n.body) };
			case "DoWhileStatement":
				return { tag: "SDoWhile", loc: n.start, body: stmt(n.body), test: expr(n.test) };
			case "ForStatement":
				return { tag: "SFor", loc: n.start, init: n.init ? (n.init.type === "VariableDeclaration" ? stmt(n.init) : { tag: "SExpr", value: expr(n.init) }) : null, test: n.test ? expr(n.test) : null, update: n.update ? expr(n.update) : null, body: stmt(n.body) };
			case "ForInStatement":
				return { tag: "SForIn", loc: n.start, init: forHead(n.left), value: expr(n.right), body: stmt(n.body) };
			case "ForOfStatement":
				return { tag: "SForOf", loc: n.start, init: forHead(n.left), value: expr(n.right), body: stmt(n.body) };
			case "WithStatement":
				return { tag: "SWith", loc: n.start, value: expr(n.object), body: stmt(n.body) };
			case "LabeledStatement":
				return { tag: "SLabel", loc: n.start, stmt: stmt(n.body) };
			case "ReturnStatement":
				return { tag: "SReturn", loc: n.start, value: n.argument ? expr(n.argument) : null };
			case "ThrowStatement":
				return { tag: "SThrow", loc: n.start, value: expr(n.argument) };
			case "SwitchStatement":
				return { tag: "SSwitch", loc: n.start, test: expr(n.discriminant), cases: n.cases.map(c => ({ value: c.test ? expr(c.test) : null, body: c.consequent.map(stmt) })) };
			case "TryStatement":
				return { tag: "STry", loc: n.start, body: n.block.body.map(stmt), catch: n.handler ? { binding: n.handler.param ? pattern(n.handler.param) : null, body: n.handler.body.body.map(stmt) } : null, finally: n.finalizer ? n.finalizer.body.map(stmt) : null };
			case "VariableDeclaration":
				return { tag: "SLocal", loc: n.start, decls: n.declarations.map(d => ({ binding: pattern(d.id), value: d.init ? expr(d.init) : null })) };
			case "FunctionDeclaration":
				return { tag: "SFunction", loc: n.start, func: fn(n) };
			case "ClassDeclaration":
				return { tag: "SClass", loc: n.start, class: klass(n) };
			case "ImportDeclaration":
				for (const s of n.specifiers) declared.add(s.local.name);
				return { tag: "SEmpty", loc: n.start };
			case "ExportNamedDeclaration":
				return n.declaration ? stmt(n.declaration) : { tag: "SEmpty", loc: n.start };
			case "ExportDefaultDeclaration":
				return /Declaration$/.test(n.declaration.type) ? stmt(n.declaration) : { tag: "SExpr", loc: n.start, value: expr(n.declaration) };
			case "ExportAllDeclaration":
				return { tag: "SEmpty", loc: n.start };
			default:
				throw new Error("statement " + n.type);
		}
	}
	return ast.body.map(stmt);
}

// ---------------------------------------------------------------------------------------------------------------------
// What Context gives a rule
// ---------------------------------------------------------------------------------------------------------------------
function makeContext(declared) {
	const reports = [];
	const isParen = w => w.kind === "paren";
	const isPrefix = w => w.kind === "paren" || w.kind === "type-assertion";
	// `Context::start`: where ESLint's node for `expr` starts.
	function start(expr) {
		let node = expr;
		// Of the node asked about, the parentheses outside its outermost TypeScript wrapper are no part of it.
		let upto = node.wrappers.findLastIndex(w => !isParen(w)) + 1;
		for (;;) {
			let op = null;
			for (const w of node.wrappers.slice(0, upto)) if (isPrefix(w)) op = w.op;
			if (op !== null) return op;
			let next;
			switch (node.tag) {
				case "EBinary":
					next = node.left;
					break;
				case "EDot":
				case "EIndex":
				case "ECall":
					next = node.target;
					break;
				case "EIf":
					next = node.test;
					break;
				case "ETemplate":
					next = node.tag_expr;
					break;
				case "EUnary":
					next = node.op.startsWith("post") ? node.value : null;
					break;
				default:
					next = null;
			}
			if (!next) return node.loc;
			node = next;
			upto = node.wrappers.length;
		}
	}
	return {
		reports,
		report: (rule, at, message) => reports.push({ rule, at, message }),
		start,
		// `None`: a TypeScript wrapper is around it.
		parentheses: expr => (expr.wrappers.every(isParen) ? expr.wrappers.length : null),
		is_typescript_wrapped: expr => !expr.wrappers.every(isParen),
		is_global: name => !declared.has(name),
	};
}

// ---------------------------------------------------------------------------------------------------------------------
// ast_utils: isConstant and what it calls
// ---------------------------------------------------------------------------------------------------------------------
const LITERAL = new Set(["ENumber", "EBoolean", "ENull", "EBigInt", "ERegExp"]);
const isLiteral = n => LITERAL.has(n.tag) || (n.tag === "EString" && !n.prefer_template);
const isTemplateLiteral = n => (n.tag === "EString" && n.prefer_template) || (n.tag === "ETemplate" && !n.tag_expr);
const UNARY = new Set(["-", "+", "!", "~", "typeof", "void", "delete"]);
const isUnary = n => n.tag === "EUnary" && UNARY.has(n.op);
const isUpdate = n => n.tag === "EUnary" && !UNARY.has(n.op);
const LOGICAL = new Set(["||", "&&", "??"]);
const isLogical = n => n.tag === "EBinary" && LOGICAL.has(n.op);
const isSequence = n => n.tag === "EBinary" && n.op === ",";
const isAssignment = n => n.tag === "EBinary" && n.op.endsWith("=") && !["==", "!=", "===", "!==", "<=", ">="].includes(n.op);
const isBinary = n => n.tag === "EBinary" && !isLogical(n) && !isSequence(n) && !isAssignment(n);
const chainOf = n => (n.tag === "EDot" || n.tag === "EIndex" || n.tag === "ECall" ? n.optional_chain : null);
// A call that is no part of an optional chain whose callee is the identifier `name`.
const isCallOf = (cx, n, names) => n.tag === "ECall" && !n.optional_chain && n.target.tag === "EIdentifier" && !cx.is_typescript_wrapped(n.target) && names.includes(n.target.name);

function getBooleanValue(n) {
	switch (n.tag) {
		case "ENull":
			return false;
		case "ERegExp":
			return true;
		case "EBoolean":
			return n.value;
		case "ENumber":
			return n.value !== 0 && !Number.isNaN(n.value);
		case "EString":
			return n.value.length > 0;
		case "EBigInt":
			return !/^(0[xXoObB])?0*$/.test(n.digits);
		default:
			return null;
	}
}
function isLogicalIdentity(cx, n, operator) {
	if (cx.is_typescript_wrapped(n)) return false;
	if (isLiteral(n)) return (operator === "||" && getBooleanValue(n) === true) || (operator === "&&" && getBooleanValue(n) === false);
	if (isUnary(n)) return operator === "&&" && n.op === "void";
	if (isLogical(n)) return operator === n.op && (isLogicalIdentity(cx, n.left, operator) || isLogicalIdentity(cx, n.right, operator));
	if (isAssignment(n)) return ["||=", "&&="].includes(n.op) && operator === n.op.slice(0, -1) && isLogicalIdentity(cx, n.right, operator);
	return false;
}
function isConstant(cx, n, inBooleanPosition) {
	if (n.tag === "EMissing") return true;
	if (cx.is_typescript_wrapped(n)) return false;
	if (isLiteral(n) || n.tag === "EArrow" || n.tag === "EFunction" || n.tag === "EClass" || n.tag === "EObject") return true;
	if (n.tag === "EString") return true;
	if (n.tag === "ETemplate") {
		if (n.tag_expr) return false;
		return (inBooleanPosition && (n.head.length > 0 || n.parts.some(p => p.tail.length > 0))) || n.parts.every(p => isConstant(cx, p.value, false));
	}
	if (n.tag === "EArray") return inBooleanPosition || n.items.every(e => isConstant(cx, e, false));
	if (isUnary(n)) {
		if (n.op === "void" || (n.op === "typeof" && inBooleanPosition)) return true;
		if (n.op === "!") return isConstant(cx, n.value, true);
		return isConstant(cx, n.value, false);
	}
	if (isBinary(n)) return isConstant(cx, n.left, false) && isConstant(cx, n.right, false) && n.op !== "in";
	if (isLogical(n)) {
		const l = isConstant(cx, n.left, inBooleanPosition);
		const r = isConstant(cx, n.right, inBooleanPosition);
		return (l && r) || (l && isLogicalIdentity(cx, n.left, n.op)) || (inBooleanPosition && r && isLogicalIdentity(cx, n.right, n.op));
	}
	if (n.tag === "ENew") return inBooleanPosition;
	if (isAssignment(n)) {
		if (n.op === "=") return isConstant(cx, n.right, inBooleanPosition);
		if (["||=", "&&="].includes(n.op) && inBooleanPosition) return isLogicalIdentity(cx, n.right, n.op.slice(0, -1));
		return false;
	}
	if (isSequence(n)) return isConstant(cx, n.right, inBooleanPosition);
	if (n.tag === "ESpread") return isConstant(cx, n.value, inBooleanPosition);
	if (isCallOf(cx, n, ["Boolean"])) return (n.args.length === 0 || isConstant(cx, n.args[0], true)) && cx.is_global("Boolean");
	if (n.tag === "EIdentifier") return n.name === "undefined" && cx.is_global("undefined");
	return false;
}

// ---------------------------------------------------------------------------------------------------------------------
// The rules. Each function is what the walk calls.
// ---------------------------------------------------------------------------------------------------------------------
const noCondAssign = {
	// `statement`: the test of if / while / do-while / for. Else the test of a conditional expression.
	test(cx, test, statement) {
		if (!isAssignment(test)) return;
		const parens = cx.parentheses(test);
		if (parens === null) return;
		if (parens < (statement ? 1 : 2)) cx.report("no-cond-assign", cx.start(test), "Expected a conditional expression and instead saw an assignment.");
	},
};

const noConstantCondition = {
	newState: () => ({ current: [], stack: [] }),
	test(cx, test) {
		if (isConstant(cx, test, true)) cx.report("no-constant-condition", cx.start(test), "Unexpected constant condition.");
	},
	track(cx, state, loop) {
		if (loop.test && isConstant(cx, loop.test, true) && !state.current.includes(loop)) state.current.push(loop);
	},
	whileEnter(cx, state, loop) {
		if (loop.test.tag === "EBoolean" && loop.test.value === true && !cx.is_typescript_wrapped(loop.test)) return;
		this.track(cx, state, loop);
	},
	exit(cx, state, loop) {
		const at = state.current.indexOf(loop);
		if (at < 0) return;
		state.current.splice(at, 1);
		cx.report("no-constant-condition", cx.start(loop.test), "Unexpected constant condition.");
	},
	enterFunction(state) {
		state.stack.push(state.current);
		state.current = [];
	},
	exitFunction(state) {
		state.current = state.stack.pop();
	},
	yield(state) {
		state.current.length = 0;
	},
};

const noExtraBooleanCast = {
	// `node` is a test, the operand of a `!`, or the first argument of a call or a `new` of the global Boolean.
	inBooleanContext(cx, node, needsBoolean) {
		if (cx.is_typescript_wrapped(node)) return;
		if (needsBoolean && !cx.is_global("Boolean")) return;
		if (node.tag === "EUnary" && node.op === "!") {
			const inner = node.value;
			if (inner.tag === "EUnary" && inner.op === "!" && !cx.is_typescript_wrapped(inner)) cx.report("no-extra-boolean-cast", node.loc, "Redundant double negation.");
		} else if (node.tag === "ECall" && node.target.tag === "EIdentifier" && node.target.name === "Boolean" && !cx.is_typescript_wrapped(node.target) && cx.is_global("Boolean")) {
			cx.report("no-extra-boolean-cast", cx.start(node), "Redundant Boolean call.");
		}
	},
	// A call or a `new`.
	callee(cx, node) {
		const t = node.target;
		if (t.tag === "EIdentifier" && t.name === "Boolean" && !cx.is_typescript_wrapped(t) && node.args.length > 0) this.inBooleanContext(cx, node.args[0], true);
	},
};

const MESSAGE_CHAIN = "Unsafe usage of optional chaining. If it short-circuits with 'undefined' the evaluation will throw TypeError.";
const noUnsafeOptionalChaining = {
	check(cx, node) {
		if (!node) return;
		// A `!` of TypeScript directly on the chain stays inside ESLint's ChainExpression: then parentheses only.
		const ws = node.wrappers;
		let i = 0;
		const chained = chainOf(node) !== null;
		if (chained) while (i < ws.length && ws[i].kind === "non-null") i++;
		if (!ws.slice(i).every(w => w.kind === "paren")) return;
		if (chained) return void cx.report("no-unsafe-optional-chaining", cx.start(node), MESSAGE_CHAIN);
		if (isLogical(node)) {
			if (node.op === "&&") this.check(cx, node.left);
			this.check(cx, node.right);
		} else if (isSequence(node)) this.check(cx, node.right);
		else if (node.tag === "EIf") {
			this.check(cx, node.yes);
			this.check(cx, node.no);
		} else if (node.tag === "EAwait") this.check(cx, node.value);
	},
	isPatternExpr: (cx, n) => (n.tag === "EObject" || n.tag === "EArray") && !cx.is_typescript_wrapped(n),
	isPatternBinding: b => b.tag === "BObject" || b.tag === "BArray",
};

const noConstantBinaryExpression = (() => {
	const isNullOrUndefined = (cx, n) => !cx.is_typescript_wrapped(n) && (n.tag === "ENull" || (n.tag === "EIdentifier" && n.name === "undefined" && cx.is_global("undefined")) || (isUnary(n) && n.op === "void"));
	const LOGICAL_ASSIGN = ["&&=", "||=", "??="];
	function hasConstantNullishness(cx, n, nonNullish) {
		if (cx.is_typescript_wrapped(n)) return false;
		if (nonNullish && isNullOrUndefined(cx, n)) return false;
		if (["EObject", "EArray", "EArrow", "EFunction", "EClass", "ENew"].includes(n.tag) || isLiteral(n) || isTemplateLiteral(n) || isUpdate(n) || isBinary(n)) return true;
		if (n.tag === "ECall") return isCallOf(cx, n, ["Boolean", "String", "Number", "Symbol", "BigInt"]) && cx.is_global(n.target.name);
		if (isLogical(n)) return n.op === "??" && hasConstantNullishness(cx, n.right, true);
		if (isAssignment(n)) {
			if (n.op === "=") return hasConstantNullishness(cx, n.right, nonNullish);
			return !LOGICAL_ASSIGN.includes(n.op);
		}
		if (isUnary(n)) return true;
		if (isSequence(n)) return hasConstantNullishness(cx, n.right, nonNullish);
		if (n.tag === "EIdentifier") return n.name === "undefined" && cx.is_global("undefined");
		return false;
	}
	const booleanCall = (cx, n) => isCallOf(cx, n, ["Boolean"]) && cx.is_global("Boolean");
	function isStaticBoolean(cx, n) {
		if (cx.is_typescript_wrapped(n)) return false;
		if (n.tag === "EBoolean") return true;
		if (n.tag === "ECall") return booleanCall(cx, n) && (n.args.length === 0 || isConstant(cx, n.args[0], true));
		if (isUnary(n)) return n.op === "!" && isConstant(cx, n.value, true);
		return false;
	}
	function hasConstantLooseBooleanComparison(cx, n) {
		if (cx.is_typescript_wrapped(n)) return false;
		if (n.tag === "EObject" || n.tag === "EClass" || n.tag === "EArrow" || n.tag === "EFunction") return true;
		if (n.tag === "EArray") return n.items.length === 0 || n.items.filter(e => e.tag !== "EMissing" && e.tag !== "ESpread").length > 1;
		if (isUnary(n)) {
			if (n.op === "void" || n.op === "typeof") return true;
			if (n.op === "!") return isConstant(cx, n.value, true);
			return false;
		}
		if (n.tag === "ECall") return booleanCall(cx, n) && (n.args.length === 0 || isConstant(cx, n.args[0], true));
		if (isLiteral(n)) return true;
		if (n.tag === "EIdentifier") return n.name === "undefined" && cx.is_global("undefined");
		if (isTemplateLiteral(n)) return n.tag === "EString";
		if (isAssignment(n)) return n.op === "=" && hasConstantLooseBooleanComparison(cx, n.right);
		if (isSequence(n)) return hasConstantLooseBooleanComparison(cx, n.right);
		return false;
	}
	const NUMERIC_OR_STRING = new Set(["+", "-", "*", "/", "%", "|", "^", "&", "**", "<<", ">>", ">>>"]);
	function hasConstantStrictBooleanComparison(cx, n) {
		if (cx.is_typescript_wrapped(n)) return false;
		if (["EObject", "EArray", "EArrow", "EFunction", "EClass", "ENew"].includes(n.tag) || isTemplateLiteral(n) || isLiteral(n) || isUpdate(n)) return true;
		if (isBinary(n)) return NUMERIC_OR_STRING.has(n.op);
		if (isUnary(n)) {
			if (n.op === "delete") return false;
			if (n.op === "!") return isConstant(cx, n.value, true);
			return true;
		}
		if (isSequence(n)) return hasConstantStrictBooleanComparison(cx, n.right);
		if (n.tag === "EIdentifier") return n.name === "undefined" && cx.is_global("undefined");
		if (isAssignment(n)) {
			if (n.op === "=") return hasConstantStrictBooleanComparison(cx, n.right);
			return !LOGICAL_ASSIGN.includes(n.op);
		}
		if (n.tag === "ECall") {
			if (isCallOf(cx, n, ["String", "Number", "BigInt", "Symbol"]) && cx.is_global(n.target.name)) return true;
			return booleanCall(cx, n) && (n.args.length === 0 || isConstant(cx, n.args[0], true));
		}
		return false;
	}
	function isAlwaysNew(cx, n) {
		if (cx.is_typescript_wrapped(n)) return false;
		if (["EObject", "EArray", "EArrow", "EFunction", "EClass", "ERegExp"].includes(n.tag)) return true;
		if (n.tag === "ENew") return n.target.tag === "EIdentifier" && !cx.is_typescript_wrapped(n.target) && ECMASCRIPT_GLOBALS.has(n.target.name) && cx.is_global(n.target.name);
		if (isSequence(n)) return isAlwaysNew(cx, n.right);
		if (isAssignment(n)) return n.op === "=" && isAlwaysNew(cx, n.right);
		if (n.tag === "EIf") return isAlwaysNew(cx, n.yes) && isAlwaysNew(cx, n.no);
		return false;
	}
	// Whether `b` makes the comparison constant.
	function constantOperand(cx, a, b, operator) {
		const strict = operator === "===" || operator === "!==";
		return (isNullOrUndefined(cx, a) && hasConstantNullishness(cx, b, false)) || (isStaticBoolean(cx, a) && (strict ? hasConstantStrictBooleanComparison(cx, b) : hasConstantLooseBooleanComparison(cx, b)));
	}
	const RULE = "no-constant-binary-expression";
	return {
		eBinary(cx, node) {
			const { op, left, right } = node;
			if (op === "&&" || op === "||") {
				if (isConstant(cx, left, true)) cx.report(RULE, cx.start(left), `Unexpected constant truthiness on the left-hand side of a \`${op}\` expression.`);
			} else if (op === "??") {
				if (hasConstantNullishness(cx, left, false)) cx.report(RULE, cx.start(left), `Unexpected constant nullishness on the left-hand side of a \`${op}\` expression.`);
			} else if (["==", "!=", "===", "!=="].includes(op)) {
				const strict = op.length === 3;
				if (constantOperand(cx, left, right, op)) cx.report(RULE, cx.start(right), `Unexpected constant binary expression. Compares constantly with the left-hand side of the \`${op}\`.`);
				else if (constantOperand(cx, right, left, op)) cx.report(RULE, cx.start(left), `Unexpected constant binary expression. Compares constantly with the right-hand side of the \`${op}\`.`);
				else if (strict) {
					if (isAlwaysNew(cx, left)) cx.report(RULE, cx.start(left), "Unexpected comparison to newly constructed object. These two values can never be equal.");
					else if (isAlwaysNew(cx, right)) cx.report(RULE, cx.start(right), "Unexpected comparison to newly constructed object. These two values can never be equal.");
				} else if (isAlwaysNew(cx, left) && isAlwaysNew(cx, right)) cx.report(RULE, cx.start(left), "Unexpected comparison of two newly constructed objects. These two values can never be equal.");
			}
		},
	};
})();

// ---------------------------------------------------------------------------------------------------------------------
// The one walk (linter.rs)
// ---------------------------------------------------------------------------------------------------------------------
function lint(stmts, cx) {
	const loops = noConstantCondition.newState();
	const tests = (test, statement) => {
		noCondAssign.test(cx, test, statement);
		noExtraBooleanCast.inBooleanContext(cx, test, false);
	};
	function visitArgs(list) {
		for (const a of list) {
			if (noUnsafeOptionalChaining.isPatternBinding(a.binding) && a.default) noUnsafeOptionalChaining.check(cx, a.default);
			visitBinding(a.binding);
			if (a.default) visitExpr(a.default);
		}
	}
	function visitFn(func, boundary) {
		if (boundary) noConstantCondition.enterFunction(loops);
		visitArgs(func.args);
		func.body.forEach(visitStmt);
		if (boundary) noConstantCondition.exitFunction(loops);
	}
	function visitClass(c) {
		noUnsafeOptionalChaining.check(cx, c.extends);
		if (c.extends) visitExpr(c.extends);
		for (const p of c.properties) {
			if (p.class_static_block) p.class_static_block.forEach(visitStmt);
			else {
				if (p.key) visitExpr(p.key);
				if (p.value) visitExpr(p.value);
			}
		}
	}
	function visitBinding(b) {
		if (b.tag === "BArray")
			for (const item of b.items) {
				if (noUnsafeOptionalChaining.isPatternBinding(item.binding) && item.default_value) noUnsafeOptionalChaining.check(cx, item.default_value);
				visitBinding(item.binding);
				if (item.default_value) visitExpr(item.default_value);
			}
		else if (b.tag === "BObject")
			for (const p of b.properties) {
				if (noUnsafeOptionalChaining.isPatternBinding(p.value) && p.default_value) noUnsafeOptionalChaining.check(cx, p.default_value);
				if (p.key) visitExpr(p.key);
				visitBinding(p.value);
				if (p.default_value) visitExpr(p.default_value);
			}
	}
	function spreads(list) {
		for (const e of list) if (e.tag === "ESpread") noUnsafeOptionalChaining.check(cx, e.value);
	}
	function visitExpr(e) {
		switch (e.tag) {
			case "EBinary":
				noConstantBinaryExpression.eBinary(cx, e);
				if (e.op === "=" && noUnsafeOptionalChaining.isPatternExpr(cx, e.left)) noUnsafeOptionalChaining.check(cx, e.right);
				if (e.op === "in" || e.op === "instanceof") noUnsafeOptionalChaining.check(cx, e.right);
				visitExpr(e.right);
				visitExpr(e.left);
				break;
			case "EUnary":
				if (e.op === "!") noExtraBooleanCast.inBooleanContext(cx, e.value, false);
				visitExpr(e.value);
				break;
			case "EIf":
				tests(e.test, false);
				noConstantCondition.test(cx, e.test);
				visitExpr(e.test);
				visitExpr(e.yes);
				visitExpr(e.no);
				break;
			case "ECall":
				noExtraBooleanCast.callee(cx, e);
				if (!e.optional_chain) noUnsafeOptionalChaining.check(cx, e.target);
				spreads(e.args);
				visitExpr(e.target);
				e.args.forEach(visitExpr);
				break;
			case "ENew":
				noExtraBooleanCast.callee(cx, e);
				noUnsafeOptionalChaining.check(cx, e.target);
				spreads(e.args);
				visitExpr(e.target);
				e.args.forEach(visitExpr);
				break;
			case "EDot":
				if (!e.optional_chain) noUnsafeOptionalChaining.check(cx, e.target);
				visitExpr(e.target);
				break;
			case "EIndex":
				if (!e.optional_chain) noUnsafeOptionalChaining.check(cx, e.target);
				visitExpr(e.target);
				visitExpr(e.index);
				break;
			case "ETemplate":
				if (e.tag_expr) {
					noUnsafeOptionalChaining.check(cx, e.tag_expr);
					visitExpr(e.tag_expr);
				}
				e.parts.forEach(p => visitExpr(p.value));
				break;
			case "EArray":
				if (!e.is_target) spreads(e.items);
				e.items.forEach(visitExpr);
				break;
			case "EObject":
				for (const p of e.properties) {
					if (p.key) visitExpr(p.key);
					visitExpr(p.value);
				}
				break;
			case "ESpread":
			case "EAwait":
				visitExpr(e.value);
				break;
			case "EYield":
				noConstantCondition.yield(loops);
				if (e.value) visitExpr(e.value);
				break;
			case "EFunction":
				visitFn(e.func, true);
				break;
			case "EArrow":
				visitFn(e, false);
				break;
			case "EClass":
				visitClass(e);
				break;
			case "EImport":
				visitExpr(e.expr);
				break;
			case "EJsxElement":
				e.children.forEach(visitExpr);
				break;
			default:
				break;
		}
	}
	function visitStmt(s) {
		switch (s.tag) {
			case "SExpr":
				visitExpr(s.value);
				break;
			case "SBlock":
				s.stmts.forEach(visitStmt);
				break;
			case "SIf":
				tests(s.test, true);
				noConstantCondition.test(cx, s.test);
				visitExpr(s.test);
				visitStmt(s.yes);
				if (s.no) visitStmt(s.no);
				break;
			case "SWhile":
				tests(s.test, true);
				noConstantCondition.whileEnter(cx, loops, s);
				visitExpr(s.test);
				visitStmt(s.body);
				noConstantCondition.exit(cx, loops, s);
				break;
			case "SDoWhile":
				tests(s.test, true);
				noConstantCondition.track(cx, loops, s);
				visitStmt(s.body);
				visitExpr(s.test);
				noConstantCondition.exit(cx, loops, s);
				break;
			case "SFor":
				if (s.test) tests(s.test, true);
				noConstantCondition.track(cx, loops, s);
				if (s.init) visitStmt(s.init);
				noConstantCondition.track(cx, loops, s);
				if (s.test) visitExpr(s.test);
				if (s.update) visitExpr(s.update);
				visitStmt(s.body);
				noConstantCondition.exit(cx, loops, s);
				break;
			case "SForIn":
				visitStmt(s.init);
				visitExpr(s.value);
				visitStmt(s.body);
				break;
			case "SForOf":
				noUnsafeOptionalChaining.check(cx, s.value);
				visitStmt(s.init);
				visitExpr(s.value);
				visitStmt(s.body);
				break;
			case "SWith":
				noUnsafeOptionalChaining.check(cx, s.value);
				visitExpr(s.value);
				visitStmt(s.body);
				break;
			case "SLabel":
				visitStmt(s.stmt);
				break;
			case "SReturn":
			case "SThrow":
				if (s.value) visitExpr(s.value);
				break;
			case "SSwitch":
				visitExpr(s.test);
				for (const c of s.cases) {
					if (c.value) visitExpr(c.value);
					c.body.forEach(visitStmt);
				}
				break;
			case "STry":
				s.body.forEach(visitStmt);
				if (s.catch) {
					if (s.catch.binding) visitBinding(s.catch.binding);
					s.catch.body.forEach(visitStmt);
				}
				if (s.finally) s.finally.forEach(visitStmt);
				break;
			case "SLocal":
				for (const d of s.decls) {
					if (noUnsafeOptionalChaining.isPatternBinding(d.binding) && d.value) noUnsafeOptionalChaining.check(cx, d.value);
					visitBinding(d.binding);
					if (d.value) visitExpr(d.value);
				}
				break;
			case "SFunction":
				visitFn(s.func, true);
				break;
			case "SClass":
				visitClass(s.class);
				break;
			default:
				break;
		}
	}
	stmts.forEach(visitStmt);
}

// ---------------------------------------------------------------------------------------------------------------------
// Comparison with ESLint
// ---------------------------------------------------------------------------------------------------------------------
function lineColumn(code, offset) {
	let line = 1;
	let last = -1;
	for (let i = 0; i < offset; i++) {
		const c = code[i];
		if (c === "\n" || c === "\u2028" || c === "\u2029" || (c === "\r" && code[i + 1] !== "\n")) {
			line++;
			last = i;
		}
	}
	return `${line}:${offset - last}`;
}
function ours(code, sourceType, withJsx) {
	const ast = (withJsx ? Parser : acorn.Parser).parse(code, { ecmaVersion: "latest", sourceType: sourceType === "commonjs" ? "script" : sourceType, preserveParens: true, allowReturnOutsideFunction: sourceType === "commonjs", allowHashBang: true });
	const declared = new Set();
	const stmts = toBun(ast, declared);
	const cx = makeContext(declared);
	lint(stmts, cx);
	return cx.reports.map(r => `${r.rule} ${lineColumn(code, r.at)} ${r.message}`);
}
function theirs(code, sourceType, withJsx) {
	const messages = linter.verify(code, [{ languageOptions: { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx: withJsx } } }, rules: Object.fromEntries(RULES.map(r => [r, "error"])) }]);
	if (messages.some(m => m.fatal)) return null;
	return messages.map(m => `${m.ruleId} ${m.line}:${m.column} ${m.message}`);
}

const show = process.argv.includes("--show");
const files = process.argv.slice(2).filter(a => !a.startsWith("--"));
const tally = { cases: 0, same: 0, differ: 0, rejected: 0, errors: 0, reports: 0 };
const perRule = {};
const seen = new Set();
for (const f of files) {
	const text = fs.readFileSync(f, "utf8");
	let list;
	if (f.endsWith(".jsonl")) list = text.split("\n").filter(Boolean).map(l => JSON.parse(l));
	else {
		const parsed = JSON.parse(text);
		list = Array.isArray(parsed) ? parsed : [...parsed.valid, ...parsed.invalid];
	}
	for (const raw of list) {
		const c = typeof raw === "string" ? { code: raw } : raw;
		if (c.skip || c.ext === "ts" || c.ext === "tsx" || seen.has(c.code)) continue;
		seen.add(c.code);
		let result = null;
		let type = null;
		let withJsx = false;
		for (const [t, j] of [["script", false], ["module", false], ["script", true], ["module", true]]) {
			const r = theirs(c.code, t, j);
			if (r) {
				result = r;
				type = t;
				withJsx = j;
				break;
			}
		}
		tally.cases++;
		if (!result) {
			tally.rejected++;
			continue;
		}
		let mine;
		try {
			mine = ours(c.code, type, withJsx);
		} catch (e) {
			tally.errors++;
			console.log(`ERROR ${JSON.stringify(c.code)}: ${e.message}`);
			continue;
		}
		tally.reports += result.length;
		for (const rule of RULES) {
			const a = [...new Set(result.filter(r => r.startsWith(rule + " ")))].sort();
			const b = [...new Set(mine.filter(r => r.startsWith(rule + " ")))].sort();
			if (!a.length && !b.length) continue;
			perRule[rule] = perRule[rule] || { same: 0, differ: 0 };
			if (JSON.stringify(a) === JSON.stringify(b)) perRule[rule].same++;
			else {
				perRule[rule].differ++;
				if (show || perRule[rule].differ <= 12) console.log(`DIFFERS [${rule}] ${JSON.stringify(c.code)}\n    eslint: ${a.map(x => x.slice(rule.length + 1)).join(" | ") || "(none)"}\n    proto:  ${b.map(x => x.slice(rule.length + 1)).join(" | ") || "(none)"}`);
			}
		}
	}
}
for (const rule of RULES) console.log(rule, JSON.stringify(perRule[rule] || {}));
console.log(JSON.stringify(tally));
