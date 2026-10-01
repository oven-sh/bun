// ESTree (espree) -> the shape of Bun's tree as written (src/ast, what Parser::parse_only / parse_for_lint keep).
// Only what the code path driver reads is kept. Every node has `t` (the variant), `at` (offset of its first token)
// and `src` (the ESTree node it stands for, used by the comparison harness alone, never by the driver's decisions).
"use strict";

const LOGICAL = new Set(["&&", "||", "??"]);

function S(t, src, rest) {
	return { t, at: src ? src.range[0] : -1, src, ...rest };
}

// `parse_stmts_up_to`: the list of a program, a block, a function body, a try/catch/finally block, a static block.
// It drops `;`, drops "use strict" and "use asm" in the leading run of string statements, and turns the other
// strings of that run into S::Directive.
function stmtsUpTo(body) {
	const out = [];
	let prologue = true;
	for (const n of body) {
		let s = stmt(n);
		let skip = s.t === "SEmpty";
		if (prologue) {
			prologue = false;
			if (s.t === "SExpr" && s.value.t === "EString" && !s.value.prefer_template) {
				prologue = true;
				if (s.value.value === "use strict" || s.value.value === "use asm") skip = true;
				else s = S("SDirective", n, {});
			}
		}
		if (!skip) out.push(s);
	}
	return out;
}

function fnBody(block) {
	return { stmts: stmtsUpTo(block.body), src: block };
}

function func(n) {
	const args = n.params.map(p => {
		if (p.type === "AssignmentPattern") return { binding: binding(p.left), default: expr(p.right), src: p };
		if (p.type === "RestElement") return { binding: binding(p.argument), rest: true, src: p };
		return { binding: binding(p) };
	});
	return { name: n.id || null, args, body: fnBody(n.body), is_generator: n.generator, is_async: n.async, src: n };
}

function klass(n) {
	const properties = n.body.body.map(m => {
		if (m.type === "StaticBlock") {
			return { kind: "class_static_block", class_static_block: { stmts: stmtsUpTo(m.body), src: m }, src: m };
		}
		const key = m.computed ? expr(m.key) : keyExpr(m.key);
		if (m.type === "MethodDefinition") {
			return {
				kind: m.kind === "get" ? "get" : m.kind === "set" ? "set" : "normal",
				is_method: true, is_static: m.static, is_computed: m.computed, key,
				value: S("EFunction", m.value, { func: func(m.value) }),
				is_constructor: m.kind === "constructor", src: m,
			};
		}
		// PropertyDefinition
		return { kind: "normal", is_static: m.static, is_computed: m.computed, key, initializer: m.value ? expr(m.value) : null, src: m };
	});
	return { class_name: n.id || null, extends: n.superClass ? expr(n.superClass) : null, properties, body_src: n.body, src: n };
}

// A key that is not computed: Bun holds an identifier key and a string key as E::String.
function keyExpr(k) {
	if (k.type === "Identifier") return S("EString", k, { value: k.name, from_identifier: true });
	if (k.type === "PrivateIdentifier") return S("EPrivateIdentifier", k, {});
	return expr(k);
}

function binding(n) {
	switch (n.type) {
		case "Identifier":
			return S("BIdentifier", n, { name: n.name });
		case "ArrayPattern": {
			const items = n.elements.map(e => {
				if (e === null) return { binding: { t: "BMissing" } };
				if (e.type === "AssignmentPattern") return { binding: binding(e.left), default_value: expr(e.right), src: e };
				if (e.type === "RestElement") return { binding: binding(e.argument), rest: true, src: e };
				return { binding: binding(e) };
			});
			return S("BArray", n, { items, has_spread: items.some(i => i.rest) });
		}
		case "ObjectPattern": {
			const properties = n.properties.map(p => {
				if (p.type === "RestElement") return { is_spread: true, value: binding(p.argument), src: p };
				const v = p.value.type === "AssignmentPattern" ? p.value : null;
				return {
					is_computed: p.computed,
					key: p.computed ? expr(p.key) : keyExpr(p.key),
					value: binding(v ? v.left : p.value),
					default_value: v ? expr(v.right) : null,
					src: p, default_src: v,
				};
			});
			return S("BObject", n, { properties });
		}
		default:
			throw new Error(`binding ${n.type}`);
	}
}

// An assignment target inside an expression: Bun writes the pattern as the literal it looks like.
function target(n) {
	switch (n.type) {
		case "ArrayPattern":
			return S("EArray", n, { items: n.elements.map(e => (e === null ? { t: "EMissing" } : target(e))), is_target: true });
		case "ObjectPattern":
			return S("EObject", n, {
				is_target: true,
				properties: n.properties.map(p => {
					if (p.type === "RestElement") return { kind: "spread", value: target(p.argument), src: p };
					if (p.shorthand) {
						const v = p.value.type === "AssignmentPattern" ? p.value : null;
						return {
							kind: "normal", was_shorthand: true, key: keyExpr(p.key),
							value: S("EIdentifier", v ? v.left : p.value, { name: p.key.name }),
							initializer: v ? expr(v.right) : null, src: p, default_src: v,
						};
					}
					return { kind: "normal", is_computed: p.computed, key: p.computed ? expr(p.key) : keyExpr(p.key), value: target(p.value), src: p };
				}),
			});
		case "AssignmentPattern":
			return S("EBinary", n, { op: "=", left: target(n.left), right: expr(n.right), is_default: true });
		case "RestElement":
			return S("ESpread", n, { value: target(n.argument), is_rest: true });
		default:
			return expr(n);
	}
}

// The links of one optional chain: `chain` is what `optional_chain` holds ("start", "continuation" or null).
function chainLink(n, insideChain) {
	// `insideChain`: a `?.` stands before this link in the same chain, or at it.
	const object = n.type === "CallExpression" ? n.callee : n.object;
	let objectHasOptional = false;
	const isLink = x => x.type === "MemberExpression" || x.type === "CallExpression";
	let objectExpr;
	if (insideChain && isLink(object)) {
		const r = chainLink(object, true);
		objectExpr = r.expr;
		objectHasOptional = r.hasOptional;
	} else {
		objectExpr = expr(object);
	}
	const chain = n.optional ? "start" : objectHasOptional ? "continuation" : null;
	const hasOptional = n.optional || objectHasOptional;
	let e;
	if (n.type === "CallExpression") {
		e = S("ECall", n, { target: objectExpr, args: n.arguments.map(expr), optional_chain: chain });
	} else if (n.computed || n.property.type === "PrivateIdentifier") {
		const index = n.computed ? expr(n.property) : S("EPrivateIdentifier", n.property, {});
		e = S("EIndex", n, { target: objectExpr, index, optional_chain: chain });
	} else {
		e = S("EDot", n, { target: objectExpr, name: n.property.name, name_src: n.property, optional_chain: chain });
	}
	return { expr: e, hasOptional };
}

function expr(n) {
	switch (n.type) {
		case "Identifier":
			return S("EIdentifier", n, { name: n.name });
		case "PrivateIdentifier":
			return S("EPrivateIdentifier", n, {});
		case "Literal":
			if (n.regex) return S("ERegExp", n, {});
			if (n.bigint !== undefined) return S("EBigInt", n, { value: n.bigint });
			if (typeof n.value === "string") return S("EString", n, { value: n.value });
			if (typeof n.value === "number") return S("ENumber", n, { value: n.value });
			if (typeof n.value === "boolean") return S("EBoolean", n, { value: n.value });
			return S("ENull", n, {});
		case "ThisExpression":
			return S("EThis", n, {});
		case "Super":
			return S("ESuper", n, {});
		case "MetaProperty":
			return S(n.meta.name === "new" ? "ENewTarget" : "EImportMeta", n, {});
		case "ArrayExpression":
			return S("EArray", n, { items: n.elements.map(e => (e === null ? { t: "EMissing" } : expr(e))) });
		case "ObjectExpression":
			return S("EObject", n, {
				properties: n.properties.map(p => {
					if (p.type === "SpreadElement") return { kind: "spread", value: expr(p.argument), src: p };
					if (p.shorthand) {
						return { kind: "normal", was_shorthand: true, key: keyExpr(p.key), value: S("EIdentifier", p.value, { name: p.key.name }), src: p };
					}
					const key = p.computed ? expr(p.key) : keyExpr(p.key);
					if (p.method || p.kind !== "init") {
						return { kind: p.kind === "init" ? "normal" : p.kind, is_method: true, is_computed: p.computed, key, value: S("EFunction", p.value, { func: func(p.value) }), src: p };
					}
					return { kind: "normal", is_computed: p.computed, key, value: expr(p.value), src: p };
				}),
			});
		case "SpreadElement":
			return S("ESpread", n, { value: expr(n.argument) });
		case "FunctionExpression":
			return S("EFunction", n, { func: func(n) });
		case "ArrowFunctionExpression": {
			const f = { ...func({ ...n, id: null, body: n.body.type === "BlockStatement" ? n.body : { body: [], range: n.body.range } }) };
			if (n.body.type !== "BlockStatement") {
				// An expression body is one S::Return in the body, and `prefer_expr` says so.
				const value = expr(n.body);
				f.body = { stmts: [S("SReturn", n.body, { value, of_arrow_expression: true })], src: null };
				return S("EArrow", n, { args: f.args, body: f.body, prefer_expr: true, is_async: n.async });
			}
			return S("EArrow", n, { args: f.args, body: f.body, prefer_expr: false, is_async: n.async });
		}
		case "ClassExpression":
			return S("EClass", n, { class: klass(n) });
		case "UnaryExpression":
		case "UpdateExpression":
			return S("EUnary", n, { op: n.operator, value: expr(n.argument) });
		case "AwaitExpression":
			return S("EAwait", n, { value: expr(n.argument) });
		case "YieldExpression":
			return S("EYield", n, { value: n.argument ? expr(n.argument) : null });
		case "BinaryExpression":
			// `#x in y` has a PrivateIdentifier on the left.
			return S("EBinary", n, { op: n.operator, left: expr(n.left), right: expr(n.right) });
		case "LogicalExpression":
			return S("EBinary", n, { op: n.operator, left: expr(n.left), right: expr(n.right) });
		case "AssignmentExpression":
			return S("EBinary", n, { op: n.operator, left: n.operator === "=" ? target(n.left) : expr(n.left), right: expr(n.right) });
		case "SequenceExpression": {
			// `a, b, c` is E::Binary(comma, E::Binary(comma, a, b), c).
			let left = expr(n.expressions[0]);
			for (let i = 1; i < n.expressions.length; i++) {
				left = { t: "EBinary", at: n.range[0], src: i === n.expressions.length - 1 ? n : null, op: ",", left, right: expr(n.expressions[i]) };
			}
			return left;
		}
		case "ConditionalExpression":
			return S("EIf", n, { test: expr(n.test), yes: expr(n.consequent), no: expr(n.alternate) });
		case "NewExpression":
			return S("ENew", n, { target: expr(n.callee), args: n.arguments.map(expr) });
		case "ImportExpression":
			return S("EImport", n, { expr: expr(n.source), options: n.options ? expr(n.options) : { t: "EMissing" } });
		case "CallExpression":
		case "MemberExpression":
			return chainLink(n, false).expr;
		case "ChainExpression":
			return chainLink(n.expression, true).expr;
		case "TemplateLiteral":
			if (n.expressions.length === 0) return S("EString", n, { value: n.quasis[0].value.cooked, prefer_template: true });
			return S("ETemplate", n, { tag: null, parts: n.expressions.map(e => ({ value: expr(e) })) });
		case "TaggedTemplateExpression":
			return S("ETemplate", n, { tag: expr(n.tag), parts: n.quasi.expressions.map(e => ({ value: expr(e) })) });
		case "JSXElement":
		case "JSXFragment":
			return jsx(n);
		// Patterns reach here only through `target`.
		case "ArrayPattern":
		case "ObjectPattern":
		case "AssignmentPattern":
		case "RestElement":
			return target(n);
		default:
			throw new Error(`expr ${n.type}`);
	}
}

function jsxName(n) {
	if (n.type === "JSXIdentifier") {
		const first = n.name[0];
		if (first === first.toLowerCase() && first !== "_" && first !== "$" || n.name.includes("-")) return S("EString", n, { value: n.name });
		return n.name === "this" ? S("EThis", n, {}) : S("EIdentifier", n, { name: n.name });
	}
	if (n.type === "JSXMemberExpression") return S("EDot", n, { target: jsxName(n.object), name: n.property.name, optional_chain: null });
	return S("EString", n, { value: `${n.namespace.name}:${n.name.name}` });
}

function jsx(n) {
	const properties = [];
	let tag = null;
	if (n.type === "JSXElement") {
		tag = jsxName(n.openingElement.name);
		for (const a of n.openingElement.attributes) {
			if (a.type === "JSXSpreadAttribute") {
				properties.push({ kind: "spread", value: expr(a.argument), src: a });
				continue;
			}
			let value = null;
			if (a.value === null) value = null;
			else if (a.value.type === "JSXExpressionContainer") value = a.value.expression.type === "JSXEmptyExpression" ? { t: "EMissing" } : expr(a.value.expression);
			else value = expr(a.value);
			properties.push({ kind: "normal", key: S("EString", a.name, {}), value, src: a });
		}
	}
	const children = [];
	for (const c of n.children) {
		if (c.type === "JSXText") {
			if (c.value.trim() !== "") children.push(S("EString", c, { value: c.value }));
		} else if (c.type === "JSXExpressionContainer") {
			if (c.expression.type !== "JSXEmptyExpression") children.push(expr(c.expression));
		} else if (c.type === "JSXSpreadChild") {
			children.push(S("ESpread", c, { value: expr(c.expression) }));
		} else {
			children.push(expr(c));
		}
	}
	return S("EJSXElement", n, { tag, properties, children });
}

function local(n, isExport) {
	return S("SLocal", n, {
		kind: n.kind,
		is_export: isExport,
		decls: n.declarations.map(d => ({ binding: binding(d.id), value: d.init ? expr(d.init) : null, src: d })),
	});
}

function stmt(n) {
	switch (n.type) {
		case "EmptyStatement":
			return S("SEmpty", n, {});
		case "DebuggerStatement":
			return S("SDebugger", n, {});
		case "ExpressionStatement":
			return S("SExpr", n, { value: expr(n.expression) });
		case "BlockStatement":
			return S("SBlock", n, { stmts: stmtsUpTo(n.body) });
		case "VariableDeclaration":
			return local(n, false);
		case "ReturnStatement":
			return S("SReturn", n, { value: n.argument ? expr(n.argument) : null });
		case "ThrowStatement":
			return S("SThrow", n, { value: expr(n.argument) });
		case "BreakStatement":
			return S("SBreak", n, { label: n.label ? n.label.name : null });
		case "ContinueStatement":
			return S("SContinue", n, { label: n.label ? n.label.name : null });
		case "IfStatement":
			return S("SIf", n, { test: expr(n.test), yes: stmt(n.consequent), no: n.alternate ? stmt(n.alternate) : null });
		case "WhileStatement":
			return S("SWhile", n, { test: expr(n.test), body: stmt(n.body) });
		case "DoWhileStatement":
			return S("SDoWhile", n, { body: stmt(n.body), test: expr(n.test) });
		case "ForStatement": {
			let init = null;
			if (n.init) init = n.init.type === "VariableDeclaration" ? local(n.init, false) : { t: "SExpr", at: n.init.range[0], src: null, value: expr(n.init) };
			return S("SFor", n, { init, test: n.test ? expr(n.test) : null, update: n.update ? expr(n.update) : null, body: stmt(n.body) });
		}
		case "ForInStatement":
		case "ForOfStatement": {
			const init = n.left.type === "VariableDeclaration" ? local(n.left, false) : { t: "SExpr", at: n.left.range[0], src: null, value: target(n.left) };
			return S(n.type === "ForInStatement" ? "SForIn" : "SForOf", n, { init, value: expr(n.right), body: stmt(n.body) });
		}
		case "SwitchStatement":
			return S("SSwitch", n, {
				test: expr(n.discriminant),
				// The body of a case is read by `parse_stmt` alone: a `;` stays.
				cases: n.cases.map(c => ({ value: c.test ? expr(c.test) : null, body: c.consequent.map(stmt), src: c })),
			});
		case "TryStatement":
			return S("STry", n, {
				body: stmtsUpTo(n.block.body), body_src: n.block,
				catch: n.handler ? { binding: n.handler.param ? binding(n.handler.param) : null, body: stmtsUpTo(n.handler.body.body), src: n.handler, body_src: n.handler.body } : null,
				finally: n.finalizer ? { stmts: stmtsUpTo(n.finalizer.body), src: n.finalizer } : null,
			});
		case "LabeledStatement":
			return S("SLabel", n, { name: n.label.name, stmt: stmt(n.body) });
		case "WithStatement":
			return S("SWith", n, { value: expr(n.object), body: stmt(n.body) });
		case "FunctionDeclaration":
			return S("SFunction", n, { func: func(n) });
		case "ClassDeclaration":
			return S("SClass", n, { class: klass(n) });
		case "ImportDeclaration":
			return S("SImport", n, {});
		case "ExportAllDeclaration":
			return S("SExportStar", n, {});
		case "ExportNamedDeclaration": {
			if (!n.declaration) return S(n.source ? "SExportFrom" : "SExportClause", n, {});
			// `export` leaves no node: the declaration has `is_export`, and its place is the declaration's.
			const inner = n.declaration.type === "VariableDeclaration" ? local(n.declaration, true) : stmt(n.declaration);
			inner.is_export = true;
			inner.export_src = n;
			return inner;
		}
		case "ExportDefaultDeclaration": {
			const d = n.declaration;
			const isStmt = d.type === "FunctionDeclaration" || d.type === "ClassDeclaration";
			return S("SExportDefault", n, { value: isStmt ? { stmt: stmt(d) } : { expr: expr(d) } });
		}
		default:
			throw new Error(`stmt ${n.type}`);
	}
}

module.exports = { program: ast => ({ stmts: stmtsUpTo(ast.body), src: ast }) };
