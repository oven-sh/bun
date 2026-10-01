// Research model of "rule-no-unused-vars" (pass 1a): ESLint's core no-unused-vars at its default options, written the way
// the Rust rule is planned: no parent pointer is read. What stands for `node.parent` is a set of tables that ONE walk fills
// (targets, forHeads, setters, exported) and one scan of a right side (scanRhs). The scope manager of ESLint stands for the
// scope view of bun_lint: only name, defs (type, name, node, init), references (identifier start, read/write, from) and
// scopes (type, upper, block, variableScope, functionExpressionScope, variables) are read from it.
// It is an ESLint rule so that check-model.cjs can run it beside the real rule in one pass.
"use strict";
const LOGICAL = new Set(["||=", "&&=", "??="]);
const isFn = n => n && (n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression");
const isLoop = n => /^(?:DoWhile|For|ForIn|ForOf|While)Statement$/u.test(n.type);
const STATEMENT = /(?:Statement|Declaration)$/u;

module.exports = {
	meta: { type: "problem", schema: [], messages: { unusedVar: "'{{varName}}' is {{action}} but never used." } },
	create(context) {
		const sourceCode = context.sourceCode;
		const keys = sourceCode.visitorKeys;
		const children = node => {
			const out = [];
			for (const key of keys[node.type] || []) {
				const value = node[key];
				if (Array.isArray(value)) for (const v of value) { if (v && typeof v.type === "string") out.push([key, v]); }
				else if (value && typeof value.type === "string") out.push([key, value]);
			}
			return out;
		};

		// ---- the tables of the walk ----
		const targets = new Map(); // start of an identifier that is the left of an assignment or the operand of ++/--
		const forHeads = new Set(); // start of an identifier in the head of a for-in/of whose body returns first
		const setters = new Set(); // the function of a setter
		const exported = new Set(); // start of the name of an exported declaration
		let loopDepth = 0;

		const patternNames = (pattern, out) => {
			if (!pattern) return out;
			switch (pattern.type) {
				case "Identifier": out.push(pattern); break;
				case "ObjectPattern": for (const p of pattern.properties) patternNames(p.type === "RestElement" ? p.argument : p.value, out); break;
				case "ArrayPattern": for (const e of pattern.elements) patternNames(e, out); break;
				case "AssignmentPattern": patternNames(pattern.left, out); break;
				case "RestElement": patternNames(pattern.argument, out); break;
			}
			return out;
		};
		const returnsFirst = body => {
			const first = body.type === "BlockStatement" ? body.body[0] : body;
			return !!first && first.type === "ReturnStatement";
		};
		const exportNames = decl => {
			if (!decl) return;
			if (decl.type === "VariableDeclaration") for (const d of decl.declarations) for (const id of patternNames(d.id, [])) exported.add(id.range[0]);
			else if ((decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") && decl.id) exported.add(decl.id.range[0]);
		};
		// `unused`: the node is an expression whose value nothing reads (ESLint's isUnusedExpression of the node itself).
		const walk = (node, unused) => {
			switch (node.type) {
				case "ExpressionStatement": walk(node.expression, true); return;
				case "SequenceExpression":
					node.expressions.forEach((e, i) => walk(e, i < node.expressions.length - 1 ? true : unused));
					return;
				case "AssignmentExpression":
					if (node.left.type === "Identifier") targets.set(node.left.range[0], { kind: "assign", logical: LOGICAL.has(node.operator), unused, inLoop: loopDepth > 0, rhs: node.right });
					break;
				case "UpdateExpression":
					if (node.argument.type === "Identifier") targets.set(node.argument.range[0], { kind: "update", unused, inLoop: loopDepth > 0 });
					break;
				case "ForInStatement":
				case "ForOfStatement":
					if (returnsFirst(node.body)) {
						if (node.left.type === "Identifier") forHeads.add(node.left.range[0]);
						if (node.left.type === "VariableDeclaration") for (const d of node.left.declarations) { if (d.id.type === "Identifier") forHeads.add(d.id.range[0]); if (d.init && d.init.type === "Identifier") forHeads.add(d.init.range[0]); }
						if (node.right.type === "Identifier") forHeads.add(node.right.range[0]);
					}
					break;
				case "Property":
				case "MethodDefinition":
					if (node.kind === "set") setters.add(node.value);
					break;
				case "ExportNamedDeclaration": exportNames(node.declaration); break;
				case "ExportDefaultDeclaration": exportNames(node.declaration); break;
			}
			const loop = isLoop(node);
			const fn = isFn(node);
			const saved = loopDepth;
			if (fn) loopDepth = 0;
			if (loop) loopDepth++;
			for (const [, child] of children(node)) walk(child, false);
			loopDepth = saved;
		};

		// ---- one scan of a right side: where the name stands in it, and whether that place is inside a storable function ----
		const scanRhs = (rhs, name) => {
			const found = new Map();
			// `state`: what isStorableFunction answers for a function that is this node. `inside`: that answer for the nearest function around.
			const scan = (node, state, inside) => {
				if (node.type === "Identifier" || node.type === "JSXIdentifier") { if (node.name === name) found.set(node.range[0], inside === true); }
				const here = isFn(node) ? state : inside;
				for (const [key, child] of children(node)) {
					let next = state;
					if (node.type === "SequenceExpression") next = child === node.expressions.at(-1) ? state : false;
					else if (node.type === "CallExpression" || node.type === "NewExpression") next = key !== "callee";
					else if (node.type === "AssignmentExpression" || node.type === "TaggedTemplateExpression" || node.type === "YieldExpression") next = true;
					else if (STATEMENT.test(node.type)) next = true;
					scan(child, next, here);
				}
			};
			scan(rhs, false, null);
			return found;
		};

		const isUsed = variable => {
			const fnDefs = [];
			for (const def of variable.defs) {
				if (def.type === "FunctionName") fnDefs.push(def.node);
				if (def.type === "Variable" && def.node.init && (def.node.init.type === "FunctionExpression" || def.node.init.type === "ArrowFunctionExpression")) fnDefs.push(def.node.init);
			}
			const selfReference = ref => { for (let s = ref.from; s; s = s.upper) if (fnDefs.includes(s.block)) return true; return false; };
			let rhs = null; // the scan of the right side that the references are measured against
			for (const ref of variable.references) {
				const at = ref.identifier.range[0];
				if (forHeads.has(at)) return true;
				const target = targets.get(at);
				const inRhs = rhs && rhs.has(at) ? { storable: rhs.get(at) } : null;
				const forItself = ref.isRead() && (
					(target && target.kind === "assign" && target.unused && !target.logical) ||
					(target && target.kind === "update" && target.unused) ||
					(inRhs && !inRhs.storable));
				if (!inRhs) {
					if (target && target.kind === "assign" && target.unused && !target.inLoop && ref.from.variableScope === variable.scope.variableScope) rhs = scanRhs(target.rhs, variable.name);
					else rhs = null;
				}
				if (ref.isRead() && !forItself && !(fnDefs.length > 0 && selfReference(ref))) return true;
			}
			return false;
		};

		// Where the variable is first defined as a parameter: the parameters of a function in the order ESLint's getDeclaredVariables has them. -1: no parameter.
		const parameterAt = variable => { const d = variable.defs.find(x => x.type === "Parameter"); return d ? d.name.range[0] : -1; };
		const isPlainParameter = def => def.node.params.some(p => p.type === "Identifier" && p.range[0] === def.name.range[0]);
		const isExported = def => {
			if (def.type === "Parameter") return false;
			return exported.has(def.name.range[0]);
		};

		return {
			"Program:exit"(program) {
				walk(program, false);
				for (const scope of sourceCode.scopeManager.scopes) {
					if (scope.functionExpressionScope) continue;
					scope.variables.forEach((variable, index) => {
						const def = variable.defs[0];
						if (!def) return; // a global without a declaration, the implicit `arguments`
						if (scope.type === "class" && scope.block.id === variable.identifiers[0]) return;
						if (def.type === "Parameter") {
							if (setters.has(def.node)) return;
							if (isPlainParameter(def) && scope.variables.some(v => parameterAt(v) > parameterAt(variable) && v.references.length > 0)) return;
						}
						if (isUsed(variable) || isExported(def)) return;
						const writes = variable.references.filter(ref => ref.isWrite() && ref.from.variableScope === scope.variableScope);
						const id = writes.length > 0 ? writes.at(-1).identifier : variable.identifiers[0];
						context.report({ node: id, messageId: "unusedVar", data: { varName: variable.name, action: variable.references.some(ref => ref.isWrite()) ? "assigned a value" : "defined" } });
					});
				}
			},
		};
	},
};
