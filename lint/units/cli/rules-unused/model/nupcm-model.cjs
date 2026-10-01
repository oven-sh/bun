// Research model of "rules-unused": ESLint's no-unused-private-class-members as an ESLint rule that reads NO parent pointer.
// One top-down walk hands each child what its parent does with it (`write`: the place only writes; `statement`: the node is
// the whole expression of an expression statement), the way src/lint/rules/no_unused_private_class_members.rs is planned.
// A class body is a frame of a stack; a reference goes to the innermost frame that declares the name.
"use strict";
module.exports = {
	meta: { type: "problem", schema: [], messages: { unusedPrivateClassMember: "'{{classMemberName}}' is defined but never used." } },
	create(context) {
		const keys = context.sourceCode.visitorKeys;
		const frames = [];
		const reference = (name, reads) => {
			for (let i = frames.length - 1; i >= 0; i--) {
				const member = frames[i].get(name);
				if (!member) continue;
				if (member.isAccessor || reads) member.used = true;
				return;
			}
		};
		const children = (node, skip) => {
			for (const key of keys[node.type] || []) {
				if (skip && skip.includes(key)) continue;
				const value = node[key];
				if (Array.isArray(value)) { for (const v of value) if (v && typeof v.type === "string") walk(v, {}); }
				else if (value && typeof value.type === "string") walk(value, {});
			}
		};
		function walk(node, cx) {
			switch (node.type) {
				case "ExpressionStatement": walk(node.expression, { statement: true }); return;
				case "AssignmentExpression":
					walk(node.left, { write: node.operator === "=" || cx.statement === true });
					walk(node.right, {});
					return;
				case "UpdateExpression": walk(node.argument, { write: cx.statement === true }); return;
				case "ForInStatement":
				case "ForOfStatement":
					walk(node.left, { write: true });
					walk(node.right, {});
					walk(node.body, {});
					return;
				case "AssignmentPattern": walk(node.left, { write: true }); walk(node.right, {}); return;
				case "ArrayPattern": for (const e of node.elements) if (e) walk(e, { write: true }); children(node, ["elements"]); return;
				case "RestElement": walk(node.argument, { write: true }); children(node, ["argument"]); return;
				case "Property":
					if (cx.inObjectPattern) {
						if (node.computed) walk(node.key, {});
						walk(node.value, { write: true });
						return;
					}
					break;
				case "ObjectPattern":
					for (const p of node.properties) walk(p, { inObjectPattern: true });
					children(node, ["properties"]);
					return;
				case "MemberExpression":
					if (node.property.type === "PrivateIdentifier") {
						reference(node.property.name, cx.write !== true);
						walk(node.object, {});
						return;
					}
					break;
				case "BinaryExpression":
					if (node.left.type === "PrivateIdentifier") { reference(node.left.name, true); walk(node.right, {}); return; }
					break;
				case "ClassBody": {
					const members = new Map();
					for (const m of node.body) {
						if ((m.type === "PropertyDefinition" || m.type === "MethodDefinition") && m.key.type === "PrivateIdentifier") {
							members.set(m.key.name, { at: m.key, isAccessor: m.type === "MethodDefinition" && (m.kind === "set" || m.kind === "get"), used: false });
						}
					}
					frames.push(members);
					// ESLint skips a private key only under a PropertyDefinition or a MethodDefinition: under any other member it is a use of the name.
					for (const m of node.body) if (m.key && m.key.type === "PrivateIdentifier" && m.type !== "PropertyDefinition" && m.type !== "MethodDefinition") reference(m.key.name, true);
					children(node);
					frames.pop();
					for (const [name, member] of members) if (!member.used) context.report({ node: member.at, messageId: "unusedPrivateClassMember", data: { classMemberName: `#${name}` } });
					return;
				}
			}
			children(node);
		}
		return { "Program:exit"(program) { walk(program, {}); } };
	},
};
