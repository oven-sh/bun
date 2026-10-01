// Research scratch. PROTOTYPE of the six rules on expression shape as they are to be written on Bun's tree.
// The ESTree of ESLint's parser (or of typescript-eslint's) is first turned into a tree that holds only what Bun's
// parse pass keeps: no parent, no end of a node, no parentheses node, no ChainExpression, no TS wrapper node;
// the `loc` of a node is its first own token (that of its leftmost operand); parentheses, `as`, `satisfies`, `!` and
// `<T>` are records beside the tree, the inner one first, as `ParsedForLint::sidecar.wrappers.records` has them.
// The rules below read that tree top-down and the records, and the tokens of the text for no-dupe-else-if.
// usage: node proto.cjs <cases.json | --code <code>...> [--ts] [--show]     compares with ESLint at the pin, case by case
"use strict";
const fs = require("fs");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const tsParser = require("module").createRequire("/workspace/ref/tseslint/package.json")("@typescript-eslint/parser");
const ES_GLOBALS = new Set(Object.keys(require("/workspace/ref/eslint/conf/globals").es2026 || require("/workspace/ref/eslint/conf/globals").es2025));

const SIX = ["no-cond-assign", "no-constant-binary-expression", "no-constant-condition", "no-dupe-else-if", "no-extra-boolean-cast", "no-unsafe-optional-chaining"];
const ASSIGN = new Set(["=", "+=", "-=", "*=", "/=", "%=", "**=", "<<=", ">>=", ">>>=", "|=", "^=", "&=", "||=", "&&=", "??="]);
const LOGICAL = new Set(["||", "&&", "??"]);

// ---------------------------------------------------------------------------------------------------------------
// ESTree -> what Bun's parse pass keeps
// ---------------------------------------------------------------------------------------------------------------
function toBun(sourceCode) {
	const W = new Map();
	const addW = (b, rec) => { let l = W.get(b); if (!l) W.set(b, (l = [])); l.push(rec); };
	const isOpen = t => t && t.type === "Punctuator" && t.value === "(";
	const isClose = t => t && t.type === "Punctuator" && t.value === ")";
	// The `(` of the syntax of the parent that stands before `node`: not a parenthesis of the node.
	function syntaxParen(node) {
		const p = node.parent;
		if (!p) return null;
		switch (p.type) {
			case "CallExpression":
			case "NewExpression":
				if (p.arguments.length === 1 && p.arguments[0] === node) return sourceCode.getTokenAfter(p.typeArguments || p.callee, { filter: isOpen });
				return null;
			case "DoWhileStatement":
				return p.test === node ? sourceCode.getTokenAfter(p.body, { filter: isOpen }) : null;
			case "IfStatement":
			case "WhileStatement":
				return p.test === node ? sourceCode.getFirstToken(p, 1) : null;
			case "ImportExpression":
				return p.source === node ? sourceCode.getFirstToken(p, 1) : null;
			case "SwitchStatement":
				return p.discriminant === node ? sourceCode.getFirstToken(p, 1) : null;
			case "WithStatement":
				return p.object === node ? sourceCode.getFirstToken(p, 1) : null;
			default:
				return null;
		}
	}
	function parenPairs(node) {
		const out = [];
		const outer = node.parent && node.parent.type === "ChainExpression" ? node.parent : node;
		const syn = syntaxParen(outer);
		let left = sourceCode.getTokenBefore(node), right = sourceCode.getTokenAfter(node);
		while (isOpen(left) && isClose(right) && left !== syn) {
			out.push({ kind: "paren", op: left.range[0], end: right.range[1] });
			left = sourceCode.getTokenBefore(left);
			right = sourceCode.getTokenAfter(right);
		}
		return out;
	}
	function chainOf(node) {
		if (node.optional) return "start";
		let child = node.type === "MemberExpression" ? node.object : node.callee;
		while (child.type === "TSNonNullExpression") child = child.expression;
		if (child.type !== "MemberExpression" && child.type !== "CallExpression") return null;
		return chainOf(child) ? "continuation" : null;
	}
	function conv(node) {
		if (!node) return null;
		let b;
		switch (node.type) {
			case "ChainExpression":
				return conv(node.expression);
			case "TSAsExpression":
			case "TSSatisfiesExpression": {
				b = conv(node.expression);
				const word = node.type === "TSAsExpression" ? "as" : "satisfies";
				const kw = sourceCode.getTokenAfter(node.expression, { filter: t => t.value === word });
				addW(b, { kind: word, op: kw.range[0], end: node.range[1] });
				break;
			}
			case "TSNonNullExpression":
				b = conv(node.expression);
				addW(b, { kind: "nonnull", op: node.range[1] - 1, end: node.range[1] });
				break;
			case "TSTypeAssertion": {
				b = conv(node.expression);
				const gt = sourceCode.getTokenAfter(node.typeAnnotation, { filter: t => t.value === ">" });
				addW(b, { kind: "assertion", op: node.range[0], end: gt.range[1] });
				break;
			}
			default:
				b = convPlain(node);
		}
		for (const p of parenPairs(node)) addW(b, p);
		return b;
	}
	function generic(node) {
		const kids = [];
		for (const key of sourceCode.visitorKeys[node.type] || []) {
			const v = node[key];
			for (const child of Array.isArray(v) ? v : [v]) if (child && typeof child.type === "string") kids.push(convAny(child));
		}
		return { t: node.type, kids: kids.filter(Boolean), loc: node.range[0] };
	}
	function convAny(node) {
		const type = node.type;
		if (/^TS.*(Type|Keyword|Annotation|Signature|TypeParameter.*|Heritage|Implements)$/.test(type) || type === "TSTypeParameterInstantiation" || type === "TSTypeParameterDeclaration" || type === "TSInterfaceBody") return null;
		if (/Statement$|Declaration$/.test(type) || ["Program", "SwitchCase", "CatchClause", "VariableDeclarator", "ClassBody", "MethodDefinition", "PropertyDefinition", "StaticBlock", "TSEnumMember", "TSModuleBlock", "TSEnumBody", "ExportSpecifier", "ImportSpecifier", "ImportDefaultSpecifier", "ImportNamespaceSpecifier", "TSExportAssignment", "AccessorProperty", "TSAbstractMethodDefinition", "TSAbstractPropertyDefinition"].includes(type)) return convStmt(node);
		if (/Pattern$/.test(type) || type === "RestElement") return { t: "Binding", b: convBinding(node) };
		return conv(node);
	}
	function convArg(p) {
		if (p.type === "TSParameterProperty") p = p.parameter;
		return p.type === "AssignmentPattern" ? { binding: convBinding(p.left), default: conv(p.right) } : { binding: convBinding(p), default: null };
	}
	function convFn(node) {
		return { generator: !!node.generator, args: node.params.map(convArg), body: node.body ? (node.body.type === "BlockStatement" ? convStmt(node.body) : conv(node.body)) : null };
	}
	function convClass(node) {
		return { extends: conv(node.superClass), body: convStmt(node.body) };
	}
	function convBinding(p) {
		switch (p.type) {
			case "Identifier":
				return { t: "BIdentifier", name: p.name };
			case "ArrayPattern":
				return { t: "BArray", items: p.elements.map(e => (e === null ? null : e.type === "AssignmentPattern" ? { binding: convBinding(e.left), default: conv(e.right) } : { binding: convBinding(e.type === "RestElement" ? e.argument : e), default: null })) };
			case "ObjectPattern":
				return {
					t: "BObject",
					props: p.properties.map(pr => {
						if (pr.type === "RestElement") return { key: null, value: convBinding(pr.argument), default: null };
						const key = pr.computed ? conv(pr.key) : null;
						return pr.value.type === "AssignmentPattern" ? { key, value: convBinding(pr.value.left), default: conv(pr.value.right) } : { key, value: convBinding(pr.value), default: null };
					}),
				};
			case "AssignmentPattern":
				return convBinding(p.left);
			default:
				return { t: "BOther" };
		}
	}
	// The left side of an assignment: Bun's tree writes a pattern there as the literal that it looks like.
	function convTarget(p) {
		switch (p.type) {
			case "ArrayPattern":
				return { t: "EArray", pattern: true, items: p.elements.map(e => (e === null ? { t: "EMissing" } : e.type === "RestElement" ? { t: "ESpread", value: convTarget(e.argument), loc: e.range[0] } : convTarget(e))), loc: p.range[0] };
			case "ObjectPattern":
				return { t: "EObject", pattern: true, props: p.properties.map(pr => (pr.type === "RestElement" ? { kind: "spread", value: convTarget(pr.argument) } : { key: pr.computed ? conv(pr.key) : null, value: convTarget(pr.value) })), loc: p.range[0] };
			case "AssignmentPattern": {
				const left = convTarget(p.left);
				return { t: "EBinary", op: "=", isDefault: true, left, right: conv(p.right), loc: left.loc };
			}
			default:
				return conv(p);
		}
	}
	function convPlain(node) {
		const loc = node.range[0];
		switch (node.type) {
			case "Identifier":
				return { t: "EIdentifier", name: node.name, loc };
			case "Literal":
				if (node.regex) return { t: "ERegExp", loc };
				if (node.bigint !== undefined) return { t: "EBigInt", text: node.raw.slice(0, -1).replace(/_/g, ""), loc };
				if (node.value === null) return { t: "ENull", loc };
				if (typeof node.value === "boolean") return { t: "EBoolean", value: node.value, loc };
				if (typeof node.value === "number") return { t: "ENumber", value: node.value, loc };
				return { t: "EString", value: node.value, template: false, loc };
			case "TemplateLiteral":
				if (node.expressions.length === 0) return { t: "EString", value: node.quasis[0].value.cooked, template: true, loc };
				return { t: "ETemplate", tag: null, head: node.quasis[0].value.cooked, parts: node.expressions.map((e, i) => ({ value: conv(e), tail: node.quasis[i + 1].value.cooked })), loc };
			case "TaggedTemplateExpression": {
				const tag = conv(node.tag);
				return { t: "ETemplate", tag, head: null, parts: node.quasi.expressions.map(e => ({ value: conv(e), tail: null })), loc: tag.loc };
			}
			case "UnaryExpression":
				return { t: "EUnary", op: node.operator, value: conv(node.argument), loc };
			case "UpdateExpression": {
				const value = conv(node.argument);
				return { t: "EUnary", op: (node.prefix ? "pre" : "post") + node.operator, value, loc: node.prefix ? loc : value.loc };
			}
			case "BinaryExpression":
			case "LogicalExpression":
			case "AssignmentExpression": {
				const left = node.type === "AssignmentExpression" ? convTarget(node.left) : node.left.type === "PrivateIdentifier" ? { t: "EPrivateIdentifier", loc: node.left.range[0] } : conv(node.left);
				if (node.type === "AssignmentExpression") for (const p of node.left.type.endsWith("Pattern") ? parenPairs(node.left) : []) addW(left, p);
				const right = conv(node.right);
				return { t: "EBinary", op: node.operator, left, right, loc: left.loc };
			}
			case "SequenceExpression": {
				let acc = conv(node.expressions[0]);
				for (const e of node.expressions.slice(1)) acc = { t: "EBinary", op: ",", left: acc, right: conv(e), loc: acc.loc };
				return acc;
			}
			case "ConditionalExpression": {
				const test = conv(node.test);
				return { t: "EIf", test, yes: conv(node.consequent), no: conv(node.alternate), loc: test.loc };
			}
			case "CallExpression": {
				const target = conv(node.callee);
				return { t: "ECall", target, args: node.arguments.map(conv), chain: chainOf(node), loc: target.loc };
			}
			case "NewExpression":
				return { t: "ENew", target: conv(node.callee), args: node.arguments.map(conv), loc };
			case "MemberExpression": {
				const target = conv(node.object);
				const chain = chainOf(node);
				if (node.computed || node.property.type === "PrivateIdentifier") return { t: "EIndex", target, index: node.computed ? conv(node.property) : { t: "EPrivateIdentifier", loc: node.property.range[0] }, chain, loc: target.loc };
				return { t: "EDot", target, name: node.property.name, chain, loc: target.loc };
			}
			case "ArrayExpression":
				return { t: "EArray", items: node.elements.map(e => (e === null ? { t: "EMissing" } : conv(e))), loc };
			case "SpreadElement":
				return { t: "ESpread", value: conv(node.argument), loc };
			case "AwaitExpression":
				return { t: "EAwait", value: conv(node.argument), loc };
			case "YieldExpression":
				return { t: "EYield", value: conv(node.argument), loc };
			case "ArrowFunctionExpression":
				return { t: "EArrow", fn: convFn(node), loc };
			case "FunctionExpression":
			case "TSEmptyBodyFunctionExpression":
				return { t: "EFunction", fn: convFn(node), loc };
			case "ClassExpression":
				return { t: "EClass", cls: convClass(node), loc };
			case "ObjectExpression":
				return { t: "EObject", props: node.properties.map(p => (p.type === "SpreadElement" ? { kind: "spread", value: conv(p.argument) } : { key: p.computed ? conv(p.key) : null, value: conv(p.value) })), loc };
			default:
				return generic(node);
		}
	}
	function convStmt(node) {
		const loc = node.range[0];
		switch (node.type) {
			case "IfStatement":
				return { t: "SIf", test: conv(node.test), yes: convStmt(node.consequent), no: node.alternate ? convStmt(node.alternate) : null, loc };
			case "WhileStatement":
				return { t: "SWhile", test: conv(node.test), body: convStmt(node.body), loc };
			case "DoWhileStatement":
				return { t: "SDoWhile", body: convStmt(node.body), test: conv(node.test), loc };
			case "ForStatement":
				return { t: "SFor", init: node.init ? (node.init.type === "VariableDeclaration" ? convStmt(node.init) : { t: "SExpr", value: conv(node.init) }) : null, test: conv(node.test), update: conv(node.update), body: convStmt(node.body), loc };
			case "ForOfStatement":
			case "ForInStatement":
				return { t: node.type === "ForOfStatement" ? "SForOf" : "SForIn", init: node.left.type === "VariableDeclaration" ? convStmt(node.left) : { t: "SExpr", value: convTarget(node.left) }, value: conv(node.right), body: convStmt(node.body), loc };
			case "WithStatement":
				return { t: "SWith", value: conv(node.object), body: convStmt(node.body), loc };
			case "VariableDeclaration":
				return node.declare ? { t: "Erased", kids: [], loc } : { t: "SLocal", decls: node.declarations.map(d => ({ binding: convBinding(d.id), value: conv(d.init) })), loc };
			case "FunctionDeclaration":
				return { t: "SFunction", fn: convFn(node), loc };
			case "TSDeclareFunction":
				return { t: "Erased", kids: [], loc };
			case "ClassDeclaration":
				return node.declare ? { t: "Erased", kids: [], loc } : { t: "SClass", cls: convClass(node), loc };
			case "ExpressionStatement":
				return { t: "SExpr", value: conv(node.expression), loc };
			case "MethodDefinition":
			case "PropertyDefinition":
			case "AccessorProperty":
				return { t: "Member", kids: [node.computed ? conv(node.key) : null, conv(node.value), ...(node.decorators || []).map(d => conv(d.expression))].filter(Boolean), loc };
			case "TSModuleDeclaration":
				return node.declare ? { t: "Erased", kids: [], loc } : generic(node);
			default:
				return generic(node);
		}
	}
	return { root: convStmt(sourceCode.ast), W };
}

// ---------------------------------------------------------------------------------------------------------------
// the six rules, on that tree
// ---------------------------------------------------------------------------------------------------------------
function lint(sourceCode, report) {
	const { root, W } = toBun(sourceCode);
	const wrappersOf = n => W.get(n) || [];
	// The names that the file declares anywhere: what a scan of `ParsedForLint::symbols` gives.
	const declared = new Set();
	for (const scope of sourceCode.scopeManager.scopes) for (const v of scope.variables) if (v.defs.length > 0 && v.isValueVariable !== false) declared.add(v.name);
	const isGlobal = name => !declared.has(name);

	// What ESLint has at the place of `n`: `n` itself, or null behind `as`, `satisfies`, `!` or `<T>`.
	const plain = n => (wrappersOf(n).some(w => w.kind !== "paren") ? null : n);
	// The parentheses around what ESLint has at the place of `n`.
	const parens = n => {
		const w = wrappersOf(n);
		let count = 0;
		for (let i = w.length - 1; i >= 0 && w[i].kind === "paren"; i--) count++;
		return count;
	};
	const leftChild = e => {
		switch (e.t) {
			case "EBinary": return e.left;
			case "EDot": case "EIndex": case "ECall": return e.target;
			case "EIf": return e.test;
			case "ETemplate": return e.tag;
			case "EUnary": return e.op.startsWith("post") ? e.value : null;
			default: return null;
		}
	};
	// Where the node `n` starts for ESLint, its own wrappers aside: at the `(` or the `<` of its first operand.
	function startOfNode(n) {
		let e = n;
		for (;;) {
			const child = leftChild(e);
			if (!child) return n.loc;
			let min = Infinity;
			for (const w of wrappersOf(child)) if (w.kind === "paren" || w.kind === "assertion") min = Math.min(min, w.op);
			if (min !== Infinity) return min;
			e = child;
		}
	}
	// Where what ESLint has at the place of `n` starts: the wrappers up to the outermost TypeScript one are part of it.
	function startOfPlace(n) {
		const w = wrappersOf(n);
		let last = -1;
		for (let i = 0; i < w.length; i++) if (w[i].kind !== "paren") last = i;
		let start = startOfNode(n);
		for (let i = 0; i <= last; i++) if (w[i].kind === "paren" || w[i].kind === "assertion") start = Math.min(start, w[i].op);
		return start;
	}
	const isAssign = n => n.t === "EBinary" && ASSIGN.has(n.op);
	const isLogical = n => n.t === "EBinary" && LOGICAL.has(n.op);
	const isComma = n => n.t === "EBinary" && n.op === ",";
	const isBinaryOp = n => n.t === "EBinary" && !ASSIGN.has(n.op) && !LOGICAL.has(n.op) && n.op !== ",";
	const isGlobalIdentifier = (n, name) => !!n && n.t === "EIdentifier" && n.name === name && isGlobal(name);

	// ---- no-cond-assign ----
	function condAssign(test, needed) {
		if (!test) return;
		const n = plain(test);
		if (!n || !isAssign(n) || parens(test) >= needed) return;
		report("no-cond-assign", startOfNode(n), "Expected a conditional expression and instead saw an assignment.");
	}

	// ---- ast-utils: isConstant, isLogicalIdentity, getBooleanValue ----
	function booleanValue(n) {
		switch (n.t) {
			case "ENull": return false;
			case "ERegExp": return true;
			case "EBoolean": return n.value;
			case "ENumber": return !!n.value;
			case "EString": return n.value.length > 0;
			case "EBigInt": return /[1-9a-fA-F]/.test(n.text.replace(/^0[xXoObB]/, ""));
			default: return null;
		}
	}
	const isLiteral = n => ["ENull", "ERegExp", "EBoolean", "ENumber", "EBigInt"].includes(n.t) || (n.t === "EString" && !n.template);
	// `isLogicalIdentity` and `isConstant` as they are to be written: the left operands of a chain of binary expressions
	// are folded in a loop, the innermost first, and what is found for a link is kept, so that a long chain costs one pass.
	const folded = new Map();
	const isSpine = n => !!n && n.t === "EBinary" && !isAssign(n) && !isComma(n);
	// [isConstant(node, flag), isLogicalIdentity(node, the operator of the node)] of the link `place`.
	function fold(place, flag) {
		const links = [];
		let known = null;
		let leaf = place;
		for (;;) {
			const n = plain(leaf);
			if (!isSpine(n)) break;
			const hit = folded.get(n);
			if (hit && hit[flag ? 1 : 0]) { known = hit[flag ? 1 : 0]; break; }
			links.push([n, flag]);
			if (!isLogical(n)) flag = false;
			leaf = n.left;
		}
		// What the link below says: its constant, and its identity for its own operator when it is a logical expression.
		let below = known ? { constant: known[0], op: isLogical(plain(leaf)) ? plain(leaf).op : null, identity: known[1] } : { constant: isConstantLeaf(leaf, flag), op: null, identity: false };
		for (let i = links.length - 1; i >= 0; i--) {
			const [n, f] = links[i];
			let constant, identity = false;
			if (isLogical(n)) {
				const leftIdentity = below.op !== null ? below.op === n.op && below.identity : isLogicalIdentityLeaf(n.left, n.op);
				const rightIdentity = isLogicalIdentity(n.right, n.op);
				const right = isConstant(n.right, f);
				constant = (below.constant && right) || (below.constant && leftIdentity) || (f && right && rightIdentity);
				identity = leftIdentity || rightIdentity;
			} else constant = below.constant && isConstant(n.right, false) && n.op !== "in";
			let slot = folded.get(n);
			if (!slot) folded.set(n, (slot = [null, null]));
			slot[f ? 1 : 0] = [constant, identity];
			below = { constant, op: isLogical(n) ? n.op : null, identity };
		}
		return below;
	}
	// `isLogicalIdentity` of what is no logical expression.
	function isLogicalIdentityLeaf(place, operator) {
		const n = plain(place);
		if (!n) return false;
		if (isLiteral(n)) return (operator === "||" && booleanValue(n) === true) || (operator === "&&" && booleanValue(n) === false);
		if (n.t === "EUnary") return operator === "&&" && n.op === "void";
		if (isAssign(n)) return (n.op === "||=" || n.op === "&&=") && operator === n.op.slice(0, -1) && isLogicalIdentity(n.right, operator);
		return false;
	}
	function isLogicalIdentity(place, operator) {
		const n = plain(place);
		if (n && isLogical(n)) return operator === n.op && fold(place, false).identity;
		return isLogicalIdentityLeaf(place, operator);
	}
	function isConstant(place, inBooleanPosition) {
		const n = plain(place);
		if (isSpine(n)) return fold(place, inBooleanPosition).constant;
		return isConstantLeaf(place, inBooleanPosition);
	}
	// The recursive text of ESLint, kept to compare: `--recursive` runs it in place of the folded one.
	function isLogicalIdentityRecursive(place, operator) {
		const n = plain(place);
		if (!n) return false;
		if (isLiteral(n)) return (operator === "||" && booleanValue(n) === true) || (operator === "&&" && booleanValue(n) === false);
		if (n.t === "EUnary") return operator === "&&" && n.op === "void";
		if (isLogical(n)) return operator === n.op && (isLogicalIdentityRecursive(n.left, operator) || isLogicalIdentityRecursive(n.right, operator));
		if (isAssign(n)) return (n.op === "||=" || n.op === "&&=") && operator === n.op.slice(0, -1) && isLogicalIdentityRecursive(n.right, operator);
		return false;
	}
	function isConstantLeaf(place, inBooleanPosition) {
		const n = plain(place);
		if (!n) return false;
		switch (n.t) {
			case "EMissing": return true;
			case "EArrow": case "EFunction": case "EClass": case "EObject": return true;
			case "EString": return true;
			case "ETemplate":
				if (n.tag) return false;
				return (inBooleanPosition && (n.head.length > 0 || n.parts.some(p => p.tail.length > 0))) || n.parts.every(p => isConstant(p.value, false));
			case "EArray": return inBooleanPosition || n.items.every(item => isConstant(item, false));
			case "EUnary":
				if (n.op.startsWith("pre") || n.op.startsWith("post")) return false;
				if (n.op === "void" || (n.op === "typeof" && inBooleanPosition)) return true;
				if (n.op === "!") return isConstant(n.value, true);
				return isConstant(n.value, false);
			case "EBinary":
				if (isComma(n)) return isConstant(n.right, inBooleanPosition);
				if (isLogical(n)) {
					const l = isConstant(n.left, inBooleanPosition), r = isConstant(n.right, inBooleanPosition);
					return (l && r) || (l && isLogicalIdentity(n.left, n.op)) || (inBooleanPosition && r && isLogicalIdentity(n.right, n.op));
				}
				if (isAssign(n)) {
					if (n.op === "=") return isConstant(n.right, inBooleanPosition);
					if ((n.op === "||=" || n.op === "&&=") && inBooleanPosition) return isLogicalIdentity(n.right, n.op.slice(0, -1));
					return false;
				}
				return isConstant(n.left, false) && isConstant(n.right, false) && n.op !== "in";
			case "ENew": return inBooleanPosition;
			case "ESpread": return isConstant(n.value, inBooleanPosition);
			case "ECall": {
				if (n.chain) return false;
				const callee = plain(n.target);
				if (callee && callee.t === "EIdentifier" && callee.name === "Boolean" && (n.args.length === 0 || isConstant(n.args[0], true))) return isGlobal("Boolean");
				return false;
			}
			case "EIdentifier": return n.name === "undefined" && isGlobal("undefined");
			default: return isLiteral(n);
		}
	}

	// ---- no-constant-condition ----
	let loops = [];
	function constantCondition(test) {
		if (test && isConstant(test, true)) report("no-constant-condition", startOfPlace(test), "Unexpected constant condition.");
	}
	function loop(node, walkInside, isWhile) {
		const test = node.test;
		const whileTrue = isWhile && (() => { const n = plain(test); return n && n.t === "EBoolean" && n.value === true; })();
		const tracked = !whileTrue && !!test && isConstant(test, true);
		if (tracked) loops.push(node);
		walkInside();
		if (tracked && loops[loops.length - 1] === node) {
			loops.pop();
			report("no-constant-condition", startOfPlace(test), "Unexpected constant condition.");
		}
	}
	function inFunction(walkInside) {
		const saved = loops;
		loops = [];
		walkInside();
		loops = saved;
	}

	// ---- no-constant-binary-expression ----
	const isCalleeNamed = (n, names) => { const c = plain(n.target); return !!c && c.t === "EIdentifier" && names.includes(c.name) && isGlobal(c.name); };
	function isNullOrUndefined(place) {
		const n = plain(place);
		return !!n && (n.t === "ENull" || isGlobalIdentifier(n, "undefined") || (n.t === "EUnary" && n.op === "void"));
	}
	function hasConstantNullishness(place, nonNullish) {
		if (nonNullish && isNullOrUndefined(place)) return false;
		const n = plain(place);
		if (!n) return false;
		switch (n.t) {
			case "EObject": case "EArray": case "EArrow": case "EFunction": case "EClass": case "ENew": case "EString": return true;
			case "ETemplate": return !n.tag;
			case "EUnary": return true;
			case "ECall": return !n.chain && isCalleeNamed(n, ["Boolean", "String", "Number", "Symbol", "BigInt"]);
			case "EBinary":
				if (isComma(n)) return hasConstantNullishness(n.right, nonNullish);
				if (isLogical(n)) return n.op === "??" && hasConstantNullishness(n.right, true);
				if (isAssign(n)) {
					if (n.op === "=") return hasConstantNullishness(n.right, nonNullish);
					return !["||=", "&&=", "??="].includes(n.op);
				}
				return true;
			case "EIdentifier": return isGlobalIdentifier(n, "undefined");
			default: return isLiteral(n);
		}
	}
	function isStaticBoolean(place) {
		const n = plain(place);
		if (!n) return false;
		if (n.t === "EBoolean") return true;
		if (n.t === "ECall") return !n.chain && isCalleeNamed(n, ["Boolean"]) && (n.args.length === 0 || isConstant(n.args[0], true));
		if (n.t === "EUnary") return n.op === "!" && isConstant(n.value, true);
		return false;
	}
	function hasConstantLooseBooleanComparison(place) {
		const n = plain(place);
		if (!n) return false;
		switch (n.t) {
			case "EObject": case "EClass": case "EArrow": case "EFunction": return true;
			case "EArray": {
				const nonSpread = n.items.filter(e => e.t !== "EMissing" && !(plain(e) && plain(e).t === "ESpread"));
				return n.items.length === 0 || nonSpread.length > 1;
			}
			case "EUnary":
				if (n.op === "void" || n.op === "typeof") return true;
				if (n.op === "!") return isConstant(n.value, true);
				return false;
			case "ECall": return !n.chain && isCalleeNamed(n, ["Boolean"]) && (n.args.length === 0 || isConstant(n.args[0], true));
			case "EIdentifier": return isGlobalIdentifier(n, "undefined");
			case "EString": return true;
			case "EBinary":
				if (isComma(n)) return hasConstantLooseBooleanComparison(n.right);
				if (isAssign(n)) return n.op === "=" && hasConstantLooseBooleanComparison(n.right);
				return false;
			default: return isLiteral(n);
		}
	}
	const NUMERIC_OR_STRING = new Set(["+", "-", "*", "/", "%", "|", "^", "&", "**", "<<", ">>", ">>>"]);
	function hasConstantStrictBooleanComparison(place) {
		const n = plain(place);
		if (!n) return false;
		switch (n.t) {
			case "EObject": case "EArray": case "EArrow": case "EFunction": case "EClass": case "ENew": case "EString": return true;
			case "ETemplate": return !n.tag;
			case "EUnary":
				if (n.op.startsWith("pre") || n.op.startsWith("post")) return true;
				if (n.op === "delete") return false;
				if (n.op === "!") return isConstant(n.value, true);
				return true;
			case "EBinary":
				if (isComma(n)) return hasConstantStrictBooleanComparison(n.right);
				if (isAssign(n)) {
					if (n.op === "=") return hasConstantStrictBooleanComparison(n.right);
					return !["||=", "&&=", "??="].includes(n.op);
				}
				if (isLogical(n)) return false;
				return NUMERIC_OR_STRING.has(n.op);
			case "EIdentifier": return isGlobalIdentifier(n, "undefined");
			case "ECall":
				if (n.chain) return false;
				if (isCalleeNamed(n, ["String", "Number", "BigInt", "Symbol"])) return true;
				if (isCalleeNamed(n, ["Boolean"])) return n.args.length === 0 || isConstant(n.args[0], true);
				return false;
			default: return isLiteral(n);
		}
	}
	function isAlwaysNew(place) {
		const n = plain(place);
		if (!n) return false;
		switch (n.t) {
			case "EObject": case "EArray": case "EArrow": case "EFunction": case "EClass": return true;
			case "ENew": { const c = plain(n.target); return !!c && c.t === "EIdentifier" && ES_GLOBALS.has(c.name) && isGlobal(c.name); }
			case "ERegExp": return true;
			case "EBinary":
				if (isComma(n)) return isAlwaysNew(n.right);
				if (isAssign(n)) return n.op === "=" && isAlwaysNew(n.right);
				return false;
			case "EIf": return isAlwaysNew(n.yes) && isAlwaysNew(n.no);
			default: return false;
		}
	}
	function findConstantOperand(a, b, operator) {
		if (operator === "==" || operator === "!=") {
			if ((isNullOrUndefined(a) && hasConstantNullishness(b, false)) || (isStaticBoolean(a) && hasConstantLooseBooleanComparison(b))) return b;
		} else if (operator === "===" || operator === "!==") {
			if ((isNullOrUndefined(a) && hasConstantNullishness(b, false)) || (isStaticBoolean(a) && hasConstantStrictBooleanComparison(b))) return b;
		}
		return null;
	}
	function constantBinary(n) {
		const rule = "no-constant-binary-expression";
		if (isLogical(n)) {
			if ((n.op === "&&" || n.op === "||") && isConstant(n.left, true)) report(rule, startOfPlace(n.left), `Unexpected constant truthiness on the left-hand side of a \`${n.op}\` expression.`);
			else if (n.op === "??" && hasConstantNullishness(n.left, false)) report(rule, startOfPlace(n.left), `Unexpected constant nullishness on the left-hand side of a \`${n.op}\` expression.`);
			return;
		}
		if (!isBinaryOp(n)) return;
		const right = findConstantOperand(n.left, n.right, n.op), left = findConstantOperand(n.right, n.left, n.op);
		if (right) report(rule, startOfPlace(right), `Unexpected constant binary expression. Compares constantly with the left-hand side of the \`${n.op}\`.`);
		else if (left) report(rule, startOfPlace(left), `Unexpected constant binary expression. Compares constantly with the right-hand side of the \`${n.op}\`.`);
		else if (n.op === "===" || n.op === "!==") {
			if (isAlwaysNew(n.left)) report(rule, startOfPlace(n.left), "Unexpected comparison to newly constructed object. These two values can never be equal.");
			else if (isAlwaysNew(n.right)) report(rule, startOfPlace(n.right), "Unexpected comparison to newly constructed object. These two values can never be equal.");
		} else if (n.op === "==" || n.op === "!=") {
			if (isAlwaysNew(n.left) && isAlwaysNew(n.right)) report(rule, startOfPlace(n.left), "Unexpected comparison of two newly constructed objects. These two values can never be equal.");
		}
	}

	// ---- no-extra-boolean-cast ----
	const isBooleanCallee = target => { const c = plain(target); return !!c && c.t === "EIdentifier" && c.name === "Boolean" && isGlobal("Boolean"); };
	function booleanContext(place) {
		if (!place) return;
		const n = plain(place);
		if (!n) return;
		if (n.t === "EUnary" && n.op === "!") {
			const inner = plain(n.value);
			if (inner && inner.t === "EUnary" && inner.op === "!") report("no-extra-boolean-cast", n.loc, "Redundant double negation.");
		} else if (n.t === "ECall" && isBooleanCallee(n.target)) report("no-extra-boolean-cast", startOfNode(n), "Redundant Boolean call.");
	}

	// ---- no-unsafe-optional-chaining ----
	// A chain that ends here: no wrapper but `!` right after it, then parentheses.
	function isChainExpression(place) {
		if (!(place.t === "EDot" || place.t === "EIndex" || place.t === "ECall") || !place.chain) return false;
		let sawParen = false;
		for (const w of wrappersOf(place)) {
			if (w.kind === "paren") sawParen = true;
			else if (w.kind !== "nonnull" || sawParen) return false;
		}
		return true;
	}
	function unsafeChain(place) {
		if (!place) return;
		if (isChainExpression(place)) return report("no-unsafe-optional-chaining", startOfNode(place), "Unsafe usage of optional chaining. If it short-circuits with 'undefined' the evaluation will throw TypeError.");
		const n = plain(place);
		if (!n) return;
		if (n.t === "EBinary") {
			if (n.op === "||" || n.op === "??") unsafeChain(n.right);
			else if (n.op === "&&") { unsafeChain(n.left); unsafeChain(n.right); }
			else if (n.op === ",") unsafeChain(n.right);
		} else if (n.t === "EIf") { unsafeChain(n.yes); unsafeChain(n.no); }
		else if (n.t === "EAwait") unsafeChain(n.value);
	}
	const isPatternLiteral = place => { const n = plain(place); return !!n && (n.t === "EArray" || n.t === "EObject"); };
	const isPatternBinding = b => b.t === "BArray" || b.t === "BObject";

	// ---- no-dupe-else-if ----
	const tokens = sourceCode.ast.tokens;
	const keys = new Map();
	function key(place, whole) {
		const known = keys.get(place);
		if (known !== undefined) return known;
		const from = startOfPlace(place);
		let i = tokens.findIndex(t => t.range[0] >= from);
		const bounded = whole || parens(place) > 0;
		let depth = 0;
		const out = [];
		for (; i >= 0 && i < tokens.length; i++) {
			const t = tokens[i];
			if (t.type === "Punctuator") {
				if (t.value === "(" || t.value === "[" || t.value === "{") depth++;
				else if (t.value === ")" || t.value === "]" || t.value === "}") {
					if (depth === 0) break;
					depth--;
				} else if (!bounded && depth === 0 && (t.value === "||" || t.value === "&&")) break;
			}
			// A template substitution is one level, as `(`: its head opens it and its tail closes it.
			if (t.type === "Template") {
				if (t.value.endsWith("${") && t.value.startsWith("`")) depth++;
				else if (t.value.startsWith("}") && t.value.endsWith("`")) depth--;
			}
			out.push(t.type + "\u0001" + t.value);
		}
		const text = out.join("\u0000");
		keys.set(place, text);
		return text;
	}
	const splitBy = (op, place) => { const n = plain(place); return n && n.t === "EBinary" && n.op === op ? [...splitBy(op, n.left), ...splitBy(op, n.right)] : [place]; };
	function dupeElseIf(head) {
		const chain = [];
		for (let s = head; s && s.t === "SIf"; s = s.no) chain.push(s);
		const roots = new Set(chain.map(s => s.test));
		const equal = (a, b) => {
			const pa = plain(a), pb = plain(b);
			const la = !!pa && pa.t === "EBinary" && (pa.op === "||" || pa.op === "&&"), lb = !!pb && pb.t === "EBinary" && (pb.op === "||" || pb.op === "&&");
			if (la && lb && pa.op === pb.op) return (equal(pa.left, pb.left) && equal(pa.right, pb.right)) || (equal(pa.left, pb.right) && equal(pa.right, pb.left));
			if (la || lb) return false;
			return key(a, roots.has(a)) === key(b, roots.has(b));
		};
		const isSubset = (arrA, arrB) => arrA.every(a => arrB.some(b => equal(a, b)));
		for (let i = 1; i < chain.length; i++) {
			const test = chain[i].test;
			const pt = plain(test);
			const conditions = pt && pt.t === "EBinary" && pt.op === "&&" ? [test, ...splitBy("&&", test)] : [test];
			let list = conditions.map(c => splitBy("||", c).map(x => splitBy("&&", x)));
			for (let j = i - 1; j >= 0; j--) {
				const current = splitBy("||", chain[j].test).map(x => splitBy("&&", x));
				list = list.map(orOperands => orOperands.filter(orOperand => !current.some(cur => isSubset(cur, orOperand))));
				if (list.some(orOperands => orOperands.length === 0)) {
					report("no-dupe-else-if", startOfPlace(test), "This branch can never execute. Its condition is a duplicate or covered by previous conditions in the if-else-if chain.");
					break;
				}
			}
		}
	}

	// ---- the one walk ----
	const elseIfs = new Set();
	function walkBinding(b) {
		if (!b) return;
		if (b.t === "BArray") for (const item of b.items) if (item) { if (item.default && isPatternBinding(item.binding)) unsafeChain(item.default); walkBinding(item.binding); walkExpr(item.default); }
		if (b.t === "BObject") for (const p of b.props) { walkExpr(p.key); if (p.default && isPatternBinding(p.value)) unsafeChain(p.default); walkBinding(p.value); walkExpr(p.default); }
	}
	function walkFn(fn) {
		for (const arg of fn.args) { if (arg.default && isPatternBinding(arg.binding)) unsafeChain(arg.default); walkBinding(arg.binding); walkExpr(arg.default); }
		if (fn.body) (fn.body.t && fn.body.t[0] === "E" ? walkExpr : walkStmt)(fn.body);
	}
	function walkClass(cls) {
		unsafeChain(cls.extends);
		walkExpr(cls.extends);
		walkStmt(cls.body);
	}
	function walkStmt(s) {
		if (!s) return;
		if (s.t === "Binding") return walkBinding(s.b);
		if (s.t[0] === "E" && s.t !== "Erased" && !s.kids) return walkExpr(s);
		switch (s.t) {
			case "SIf":
				condAssign(s.test, 1);
				constantCondition(s.test);
				booleanContext(s.test);
				if (!elseIfs.delete(s)) dupeElseIf(s);
				if (s.no && s.no.t === "SIf") elseIfs.add(s.no);
				walkExpr(s.test); walkStmt(s.yes); walkStmt(s.no);
				return;
			case "SWhile":
				condAssign(s.test, 1);
				booleanContext(s.test);
				loop(s, () => { walkExpr(s.test); walkStmt(s.body); }, true);
				return;
			case "SDoWhile":
				condAssign(s.test, 1);
				booleanContext(s.test);
				loop(s, () => { walkStmt(s.body); walkExpr(s.test); }, false);
				return;
			case "SFor":
				condAssign(s.test, 1);
				booleanContext(s.test);
				walkStmt(s.init);
				loop(s, () => { walkExpr(s.test); walkExpr(s.update); walkStmt(s.body); }, false);
				return;
			case "SForOf":
				unsafeChain(s.value);
			// falls through
			case "SForIn":
				walkStmt(s.init); walkExpr(s.value); walkStmt(s.body);
				return;
			case "SWith":
				unsafeChain(s.value);
				walkExpr(s.value); walkStmt(s.body);
				return;
			case "SLocal":
				for (const d of s.decls) { if (d.value && isPatternBinding(d.binding)) unsafeChain(d.value); walkBinding(d.binding); walkExpr(d.value); }
				return;
			case "SFunction":
				inFunction(() => walkFn(s.fn));
				return;
			case "SClass":
				walkClass(s.cls);
				return;
			case "SExpr":
				walkExpr(s.value);
				return;
			default:
				for (const kid of s.kids || []) walkStmt(kid);
		}
	}
	function walkExpr(e) {
		if (!e) return;
		if (e.t === "Binding") return walkBinding(e.b);
		if (e.t[0] === "S" || e.kids) return (e.kids || []).length || e.t[0] !== "S" ? (e.t[0] === "S" ? walkStmt(e) : (e.kids || []).forEach(walkStmt)) : walkStmt(e);
		switch (e.t) {
			case "EBinary":
				constantBinary(e);
				if (e.op === "in" || e.op === "instanceof") unsafeChain(e.right);
				if (e.op === "=" && isPatternLiteral(e.left)) unsafeChain(e.right);
				walkExpr(e.right); walkExpr(e.left);
				return;
			case "EUnary":
				if (e.op === "!") booleanContext(e.value);
				walkExpr(e.value);
				return;
			case "EIf":
				condAssign(e.test, 2);
				constantCondition(e.test);
				booleanContext(e.test);
				walkExpr(e.test); walkExpr(e.yes); walkExpr(e.no);
				return;
			case "ECall":
			case "ENew":
				if (isBooleanCallee(e.target)) booleanContext(e.args[0]);
				if (e.t === "ENew" || e.chain !== "start") { if (e.t === "ENew" || !e.chain) unsafeChain(e.target); }
				for (const arg of e.args) if (arg.t === "ESpread") unsafeChain(arg.value);
				walkExpr(e.target); e.args.forEach(walkExpr);
				return;
			case "EDot":
				if (!e.chain) unsafeChain(e.target);
				walkExpr(e.target);
				return;
			case "EIndex":
				if (!e.chain) unsafeChain(e.target);
				walkExpr(e.target); walkExpr(e.index);
				return;
			case "ETemplate":
				if (e.tag) unsafeChain(e.tag);
				walkExpr(e.tag); e.parts.forEach(p => walkExpr(p.value));
				return;
			case "EArray":
				if (!e.pattern) for (const item of e.items) if (item.t === "ESpread") unsafeChain(item.value);
				e.items.forEach(walkExpr);
				return;
			case "EObject":
				for (const p of e.props) { walkExpr(p.key); walkExpr(p.value); }
				return;
			case "ESpread": case "EAwait":
				walkExpr(e.value);
				return;
			case "EYield":
				loops.length = 0;
				walkExpr(e.value);
				return;
			case "EFunction":
				inFunction(() => walkFn(e.fn));
				return;
			case "EArrow":
				walkFn(e.fn);
				return;
			case "EClass":
				walkClass(e.cls);
				return;
			default:
				return;
		}
	}
	walkStmt(root);
}

// ---------------------------------------------------------------------------------------------------------------
// the comparison with ESLint
// ---------------------------------------------------------------------------------------------------------------
const plugin = {
	rules: {
		all: {
			meta: { schema: [] },
			create(context) {
				return {
					"Program:exit"() {
						const sourceCode = context.sourceCode;
						lint(sourceCode, (rule, offset, message) => {
							const loc = sourceCode.getLocFromIndex(offset);
							context.report({ loc: { start: loc, end: loc }, message: `${rule}\u0001${message}` });
						});
					},
				};
			},
		},
	},
};
const linter = new Linter({ configType: "flat" });
function run(code, { ts, tsx, jsx, sourceType }) {
	const rules = { ...Object.fromEntries(SIX.map(r => [r, "error"])), "proto/all": "error" };
	const attempts = ts ? [[sourceType || "module", !!tsx]] : [[sourceType || "script", !!jsx], ["module", !!jsx], ["script", true], ["module", true]];
	let messages;
	for (const [type, withJsx] of attempts) {
		const languageOptions = ts ? { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: withJsx } }, sourceType: type } : { ecmaVersion: "latest", sourceType: type, parserOptions: { ecmaFeatures: { jsx: withJsx } } };
		messages = linter.verify(code, [{ files: ["**/*.js", "**/*.ts", "**/*.tsx"], plugins: { proto: plugin }, languageOptions, rules }], { filename: ts ? (tsx ? "a.tsx" : "a.ts") : "a.js" });
		if (!messages.some(m => m.fatal)) break;
	}
	if (messages.some(m => m.fatal)) return { fatal: messages.find(m => m.fatal).message };
	const eslint = [], proto = [];
	for (const m of messages) {
		if (m.ruleId === "proto/all") {
			const [rule, text] = m.message.split("\u0001");
			proto.push(`${rule} ${m.line}:${m.column} ${text}`);
		} else eslint.push(`${m.ruleId} ${m.line}:${m.column} ${m.message}`);
	}
	const uniq = l => [...new Set(l)].sort();
	return { eslint: uniq(eslint), proto: uniq(proto) };
}

if (require.main === module) {
	const args = process.argv.slice(2);
	const ts = args.includes("--ts");
	const show = args.includes("--show");
	let cases;
	const at = args.indexOf("--code");
	if (at >= 0) cases = args.slice(at + 1).filter(a => !a.startsWith("--")).map(code => ({ code }));
	else {
		const parsed = JSON.parse(fs.readFileSync(args.find(a => a.endsWith(".json")), "utf8"));
		cases = (Array.isArray(parsed) ? parsed : [...parsed.valid, ...parsed.invalid]).map(c => (typeof c === "string" ? { code: c } : c)).filter(c => !(c.languageOptions && c.languageOptions.globals));
	}
	let same = 0, differ = 0, fatal = 0;
	for (const c of cases) {
		const tsx = c.ext === "tsx" || c.code.startsWith("//tsx\n");
		const lo = c.languageOptions || {};
		const r = run(c.code, { ts: ts || (c.ext && c.ext.includes("ts")), tsx, jsx: c.jsx || !!(lo.parserOptions && lo.parserOptions.ecmaFeatures && lo.parserOptions.ecmaFeatures.jsx), sourceType: lo.sourceType });
		if (r.fatal) { fatal++; console.log(`FATAL ${JSON.stringify(c.code)}: ${r.fatal}`); continue; }
		const ok = JSON.stringify(r.eslint) === JSON.stringify(r.proto);
		if (ok) same++; else differ++;
		if (!ok || show) console.log(`${ok ? "same  " : "DIFFER"} ${JSON.stringify(c.code)}\n    eslint: ${r.eslint.join(" | ") || "(none)"}${ok ? "" : `\n    proto:  ${r.proto.join(" | ") || "(none)"}`}`);
	}
	console.log(`cases ${cases.length}: same ${same}, differ ${differ}, rejected by the parser ${fatal}`);
}
module.exports = { run };
