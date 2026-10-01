// Converts the expression part of an espree tree to the shape of Bun's tree as written:
// kinds E*, loc = start of the leftmost token (parentheses not counted), no end offsets.
// Offsets are UTF-8 byte offsets (the `at` map converts from UTF-16 indices).
"use strict";

function convert(ast, at) {
	const E = (kind, loc, more) => Object.assign({ kind, loc }, more);

	function prop(p, inPattern) {
		if (p.type === "SpreadElement" || p.type === "RestElement" || p.type === "ExperimentalSpreadProperty") {
			return { pkind: "Spread", value: expr(p.argument, inPattern), key: null, initializer: null, flags: {} };
		}
		// Property
		const flags = { IsComputed: p.computed, IsMethod: !!p.method, WasShorthand: !!p.shorthand };
		let key;
		if (!p.computed && p.key.type === "Identifier") key = E("EString", at[p.key.range[0]], { value: p.key.name });
		else key = expr(p.key, false);
		const pkind = p.kind === "get" ? "Get" : p.kind === "set" ? "Set" : "Normal";
		let value;
		let initializer = null;
		if (p.shorthand && p.value.type === "AssignmentPattern") {
			// `{a = 1}`: the value is the identifier, the default is the initializer.
			value = expr(p.value.left, inPattern);
			initializer = expr(p.value.right, false);
		} else {
			value = expr(p.value, inPattern);
		}
		return { pkind, key, value, initializer, flags };
	}

	function expr(n, inPattern) {
		if (n === null) return null;
		switch (n.type) {
			case "Identifier":
				return E("EIdentifier", at[n.range[0]], { name: n.name });
			case "PrivateIdentifier":
				return E("EPrivateIdentifier", at[n.range[0]], { name: "#" + n.name });
			case "ThisExpression":
				return E("EThis", at[n.range[0]]);
			case "Super":
				return E("ESuper", at[n.range[0]]);
			case "Literal":
				if (n.regex) return E("ERegExp", at[n.range[0]], { value: n.raw });
				if (n.bigint !== undefined) return E("EBigInt", at[n.range[0]], { value: n.raw.slice(0, -1).replace(/_/g, "") });
				if (n.value === null) return E("ENull", at[n.range[0]]);
				if (typeof n.value === "boolean") return E("EBoolean", at[n.range[0]], { value: n.value });
				if (typeof n.value === "number") return E("ENumber", at[n.range[0]], { value: n.value });
				return E("EString", at[n.range[0]], { value: n.value, prefer_template: false });
			case "TemplateLiteral":
				if (n.expressions.length === 0)
					return E("EString", at[n.range[0]], { value: n.quasis[0].value.cooked, prefer_template: true });
				return E("ETemplate", at[n.range[0]], { tag: null, parts: n.expressions.map(x => expr(x, false)) });
			case "TaggedTemplateExpression": {
				const tag = expr(n.tag, false);
				return E("ETemplate", tag.loc, { tag, parts: n.quasi.expressions.map(x => expr(x, false)) });
			}
			case "ChainExpression":
				return expr(n.expression, false);
			case "MemberExpression": {
				const target = expr(n.object, false);
				if (n.property.type === "PrivateIdentifier")
					return E("EIndex", target.loc, { target, index: expr(n.property, false), optional: n.optional });
				if (!n.computed)
					return E("EDot", target.loc, {
						target,
						name: n.property.name,
						name_loc: at[n.property.range[0]],
						optional: n.optional,
					});
				return E("EIndex", target.loc, { target, index: expr(n.property, false), optional: n.optional });
			}
			case "CallExpression": {
				const target = expr(n.callee, false);
				return E("ECall", target.loc, { target, args: n.arguments.map(x => expr(x, false)) });
			}
			case "NewExpression":
				return E("ENew", at[n.range[0]], { target: expr(n.callee, false), args: n.arguments.map(x => expr(x, false)) });
			case "AssignmentExpression": {
				const left = expr(n.left, true);
				const op = { "=": "BinAssign", "&&=": "BinLogicalAndAssign", "||=": "BinLogicalOrAssign", "??=": "BinNullishCoalescingAssign" }[n.operator] || "BinOtherAssign";
				return E("EBinary", left.loc, { op, left, right: expr(n.right, false) });
			}
			case "AssignmentPattern": {
				// In an expression-shaped pattern Bun keeps `a = 1` as an assignment.
				const left = expr(n.left, true);
				return E("EBinary", left.loc, { op: "BinAssign", left, right: expr(n.right, false) });
			}
			case "BinaryExpression":
			case "LogicalExpression": {
				const left = expr(n.left, false);
				return E("EBinary", left.loc, { op: "Bin" + n.operator, left, right: expr(n.right, false) });
			}
			case "SequenceExpression": {
				let acc = expr(n.expressions[0], false);
				for (let i = 1; i < n.expressions.length; i++)
					acc = E("EBinary", acc.loc, { op: "BinComma", left: acc, right: expr(n.expressions[i], false) });
				return acc;
			}
			case "ConditionalExpression": {
				const test = expr(n.test, false);
				return E("EIf", test.loc, { test, yes: expr(n.consequent, false), no: expr(n.alternate, false) });
			}
			case "UnaryExpression":
			case "AwaitExpression":
			case "YieldExpression":
				return E("EUnary", at[n.range[0]], { value: n.argument ? expr(n.argument, false) : null });
			case "UpdateExpression": {
				const value = expr(n.argument, false);
				return E("EUnary", n.prefix ? at[n.range[0]] : value.loc, { value });
			}
			case "ArrayExpression":
			case "ArrayPattern":
				return E("EArray", at[n.range[0]], {
					items: n.elements.map(x => (x === null ? E("EMissing", -1) : expr(x, inPattern))),
				});
			case "SpreadElement":
			case "RestElement":
				return E("ESpread", at[n.range[0]], { value: expr(n.argument, inPattern) });
			case "ObjectExpression":
			case "ObjectPattern":
				return E("EObject", at[n.range[0]], { properties: n.properties.map(p => prop(p, inPattern)) });
			case "FunctionExpression":
			case "ArrowFunctionExpression":
				return E("EFunction", at[n.range[0]], { body: n.body, params: n.params });
			case "ClassExpression":
				return E("EClass", at[n.range[0]], { node: n });
			case "MetaProperty":
				return E("EMeta", at[n.range[0]]);
			case "ImportExpression":
				return E("EImport", at[n.range[0]], { value: expr(n.source, false) });
			default:
				return E("EOther:" + n.type, at[n.range[0]]);
		}
	}
	return { expr };
}

module.exports = { convert };
