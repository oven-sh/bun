// Research model of "rule-no-unused-vars" (pass 1a): the no-unused-vars of typescript-eslint 8.58.2 at its default options,
// written the way the Rust rule is planned for a TypeScript file: no parent pointer is read. One walk fills the tables
// (targets, forHeads, setters, exported, marked, typeQueries, typePredicates), one scan reads a right side (scanRhs).
// The scope manager of typescript-eslint stands for the scope view of bun_lint.
"use strict";
const LOGICAL = new Set(["||=", "&&=", "??="]);
const isFn = n => n && (n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression");
const isLoop = n => /^(?:DoWhile|For|ForIn|ForOf|While)Statement$/u.test(n.type);
const SIGNATURES = new Set(["TSCallSignatureDeclaration", "TSConstructorType", "TSConstructSignatureDeclaration", "TSDeclareFunction", "TSEmptyBodyFunctionExpression", "TSFunctionType", "TSMethodSignature"]);
const AMBIENT_CHILDREN = new Set(["TSInterfaceDeclaration", "TSTypeAliasDeclaration", "ClassDeclaration", "TSDeclareFunction", "TSEnumDeclaration", "TSModuleDeclaration", "VariableDeclaration"]);
const isDefinitionFile = name => /\.d\.(ts|cts|mts|.*\.ts)$/.test(name.toLowerCase());

module.exports = {
	meta: { type: "problem", schema: [], messages: { unusedVar: "'{{varName}}' is {{action}} but never used.", usedOnlyAsType: "'{{varName}}' is {{action}} but only used as a type." } },
	create(context) {
		const sourceCode = context.sourceCode;
		const keys = sourceCode.visitorKeys;
		const definitionFile = isDefinitionFile(context.filename);
		const children = node => {
			const out = [];
			for (const key of keys[node.type] || []) {
				const value = node[key];
				if (Array.isArray(value)) for (const v of value) { if (v && typeof v.type === "string") out.push([key, v]); }
				else if (value && typeof value.type === "string") out.push([key, value]);
			}
			return out;
		};
		const targets = new Map(), forHeads = new Set(), setters = new Set(), exported = new Set(), marked = new Set(), typeQueries = new Set(), typePredicates = new Set();
		const globalBlocks = []; // a `global { }` block that stands inside a module declaration: that declaration
		const namedInParameters = []; // every identifier, whatever it is, inside the parameters of a signature or of a setter
		const parameterLists = []; // [owner, params] of each signature and of each setter
		const identifiersUnder = (node, out) => { if (node.type === "Identifier") out.push(node); for (const [, child] of children(node)) identifiersUnder(child, out); return out; };
		let loopDepth = 0;

		const patternNames = (pattern, out) => {
			if (!pattern) return out;
			switch (pattern.type) {
				case "Identifier": out.push(pattern); break;
				case "ObjectPattern": for (const p of pattern.properties) patternNames(p.type === "RestElement" ? p.argument : p.value, out); break;
				case "ArrayPattern": for (const e of pattern.elements) patternNames(e, out); break;
				case "AssignmentPattern": patternNames(pattern.left, out); break;
				case "RestElement": patternNames(pattern.argument, out); break;
				case "TSParameterProperty": patternNames(pattern.parameter, out); break;
			}
			return out;
		};
		const declaredNames = decl => {
			if (!decl) return [];
			if (decl.type === "VariableDeclaration") return decl.declarations.flatMap(d => patternNames(d.id, []));
			return decl.id && decl.id.type === "Identifier" ? [decl.id] : [];
		};
		const overriding = body => body.some(s => (s.type === "ExportNamedDeclaration" && s.declaration == null) || s.type === "ExportAllDeclaration" || s.type === "TSExportAssignment" || (s.type === "ExportDefaultDeclaration" && s.declaration.type === "Identifier"));
		const markAmbient = body => {
			if (overriding(body)) return;
			for (const s of body) if (AMBIENT_CHILDREN.has(s.type)) for (const id of declaredNames(s)) marked.add(id.range[0]);
		};
		// `unused`: nothing reads the value of the expression. `declared`: a module declaration with `declare` is around. `module`: the module declaration around.
		const walk = (node, unused, declared, module) => {
			switch (node.type) {
				case "Program": if (definitionFile) markAmbient(node.body); break;
				case "ExpressionStatement": walk(node.expression, true, declared, module); return;
				case "SequenceExpression":
					node.expressions.forEach((e, i) => walk(e, i < node.expressions.length - 1 ? true : unused, declared, module));
					return;
				case "AssignmentExpression":
					if (node.left.type === "Identifier") targets.set(node.left.range[0], { kind: "assign", logical: LOGICAL.has(node.operator), unused, inLoop: loopDepth > 0, rhs: node.right });
					break;
				case "UpdateExpression":
					if (node.argument.type === "Identifier") targets.set(node.argument.range[0], { kind: "update", unused, inLoop: loopDepth > 0 });
					break;
				case "ForInStatement":
				case "ForOfStatement": {
					const body = node.body.type === "BlockStatement" ? (node.body.body.length === 1 ? node.body.body[0] : null) : node.body;
					if (body && body.type === "ReturnStatement") {
						if (node.left.type === "Identifier") forHeads.add(node.left.range[0]);
						if (node.left.type === "VariableDeclaration") { const first = declaredNames(node.left)[0]; if (first) marked.add(first.range[0]); }
					}
					break;
				}
				case "Property":
				case "MethodDefinition":
					if (node.kind === "set") { setters.add(node.value); parameterLists.push([node.value, node.value.params]); for (const p of node.value.params) identifiersUnder(p, namedInParameters); }
					break;
				case "TSParameterProperty": for (const id of patternNames(node.parameter, []).slice(0, 1)) marked.add(id.range[0]); break;
				case "ExportNamedDeclaration":
				case "ExportDefaultDeclaration": for (const id of declaredNames(node.declaration)) exported.add(id.range[0]); break;
				case "TSTypeQuery": { let e = node.exprName; while (e.type === "TSQualifiedName") e = e.left; if (e.type === "Identifier") typeQueries.add(e.range[0]); break; }
				case "TSTypePredicate": if (node.parameterName.type === "Identifier") typePredicates.add(node.parameterName.range[0]); break;
				case "TSModuleDeclaration":
					if (node.kind === "global" && module) globalBlocks.push(module);
					if (node.body && node.body.type === "TSModuleBlock" && (node.declare || declared || definitionFile)) markAmbient(node.body.body);
					break;
			}
			if (SIGNATURES.has(node.type)) { parameterLists.push([node, node.params]); for (const p of node.params) identifiersUnder(p, namedInParameters); }
			const saved = loopDepth;
			if (isFn(node)) loopDepth = 0;
			if (isLoop(node)) loopDepth++;
			const isModule = node.type === "TSModuleDeclaration";
			for (const [, child] of children(node)) walk(child, false, declared || (isModule && node.declare === true), isModule ? node : module);
			loopDepth = saved;
		};

		const scanRhs = (rhs, name) => {
			const found = new Map();
			const scan = (node, state, inside) => {
				if (node.type === "Identifier" || node.type === "JSXIdentifier") { if (node.name === name) found.set(node.range[0], inside === true); }
				const here = isFn(node) ? state : inside;
				for (const [key, child] of children(node)) {
					let next = state;
					if (node.type === "SequenceExpression") next = child === node.expressions.at(-1) ? state : false;
					else if (node.type === "CallExpression" || node.type === "NewExpression") next = key !== "callee";
					else if (node.type === "AssignmentExpression" || node.type === "TaggedTemplateExpression" || node.type === "YieldExpression") next = true;
					else if (node.type.endsWith("Statement") || node.type.endsWith("Declaration")) next = true;
					scan(child, next, here);
				}
			};
			scan(rhs, false, null);
			return found;
		};

		// ---- BUN_VIEW=names|chain: what a lint parse does not build (the body and the heritage of an interface, the type of an alias,
		// an index signature of a class) is not referenced and declares nothing; every identifier token in it marks a variable of its name.
		const view = process.env.BUN_VIEW || "";
		const regions = [];
		const weakNames = new Set(), weakAt = [];
		const inRegion = at => regions.some(r => at >= r[0] && at < r[1]);
		const collectRegions = node => {
			if (node.type === "TSInterfaceDeclaration") regions.push([(node.typeParameters || node.id).range[1], node.range[1], node]);
			else if (node.type === "TSTypeAliasDeclaration") regions.push([node.typeAnnotation.range[0], node.range[1], node]);
			else if (node.type === "TSIndexSignature" && node.parent && node.parent.type === "ClassBody") regions.push([node.range[0], node.range[1], node]);
			for (const [, child] of children(node)) collectRegions(child);
		};
		const inlineTypeImport = def => def.type === "ImportBinding" && def.node.type === "ImportSpecifier" && def.node.importKind === "type" && def.parent.importKind !== "type";
		const isTypeImport = def => def.type === "ImportBinding" && (def.parent.importKind === "type" || (def.node.type === "ImportSpecifier" && def.node.importKind === "type"));
		const onlyAsType = ref => typeQueries.has(ref.identifier.range[0]) || typePredicates.has(ref.identifier.range[0]);
		const isUsed = variable => {
			const fnDefs = [], typeDecls = [], blocks = [];
			for (const def of variable.defs) {
				if (def.type === "FunctionName") fnDefs.push(def.node);
				if (def.type === "Variable" && def.node.init && (def.node.init.type === "FunctionExpression" || def.node.init.type === "ArrowFunctionExpression")) fnDefs.push(def.node.init);
				if (def.node.type === "TSInterfaceDeclaration" || def.node.type === "TSTypeAliasDeclaration") typeDecls.push(def.node.range);
				if (def.node.type === "TSModuleDeclaration" || def.node.type === "TSEnumDeclaration") blocks.push(def.node);
			}
			const from = (ref, nodes) => { for (let s = ref.from; s; s = s.upper) if (nodes.includes(s.block)) return true; return false; };
			const importedAsType = variable.defs.every(isTypeImport);
			let rhs = null;
			for (const ref of refsOf(variable)) {
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
				if (ref.isRead() && !forItself &&
					!(!importedAsType && onlyAsType(ref)) &&
					!(fnDefs.length > 0 && from(ref, fnDefs)) &&
					!typeDecls.some(range => at >= range[0] && ref.identifier.range[1] <= range[1]) &&
					!(blocks.length > 0 && from(ref, blocks))) return true;
			}
			return false;
		};
		const refsOf = variable => (view ? variable.references.filter(ref => !inRegion(ref.identifier.range[0])) : variable.references);
		const isMarked = (variable, scope) => {
			if (variable.name === "this") return true;
			if (scope.type === "class" && scope.block.id && scope.block.id === variable.identifiers[0]) return true;
			if (scope.type === "tsEnum" || scope.type === "mappedType") return true;
			const def = variable.defs[0];
			if (variable.defs.some(d => d.type === "Parameter" && (SIGNATURES.has(d.node.type) || setters.has(d.node)))) return true;
			void def;
			return variable.defs.some(d => d.name && d.name.range && marked.has(d.name.range[0]));
		};
		const isPlainParameter = def => (def.node.params || []).some(p => p.type === "Identifier" && p.range[0] === def.name.range[0]);

		return {
			"Program:exit"(program) {
				walk(program, false, false, null);
				const scopeManager = sourceCode.scopeManager;
				if (view) {
					collectRegions(program);
					for (const token of sourceCode.ast.tokens) if ((token.type === "Identifier" || token.type === "Keyword") && /^[\p{ID_Start}$_]/u.test(token.value) && inRegion(token.range[0])) { weakNames.add(token.value); weakAt.push(token); }
				}
				// `global { }` inside a module declaration: the nearest variable named `global` from that declaration up is used.
				const quirk = new Set();
				for (const module of globalBlocks) {
					for (let s = scopeManager.acquire(module, true); s; s = s.upper) { const v = s.variables.find(x => x.name === "global"); if (v) { quirk.add(v); break; } }
				}
				// The model may read `parent` here: it stands for "the innermost scope at the identifier", which the scope pass knows.
				const scopeAt = node => { const inner = node.type !== "Program"; for (let n = node; n; n = n.parent) { const s = scopeManager.acquire(n, inner); if (s) return s.type === "functionExpressionName" ? s.childScopes[0] : s; } return scopeManager.scopes[0]; };
				if (view === "chain" || view === "nearest") {
					// chain: every variable of the name on the way up from the scope of the declaration that holds the token. nearest: the first one only.
					for (const token of weakAt) {
						const region = regions.find(r => token.range[0] >= r[0] && token.range[0] < r[1]);
						up: for (let s = scopeAt(region[2]); s; s = s.upper) for (const v of s.variables) if (v.name === token.value) { quirk.add(v); if (view === "nearest") break up; }
					}
				}
				if (process.env.BUN_SIG === "tokens") {
					// BUN_SIG=tokens: in place of the identifier nodes of a parameter list, every identifier token between its first and last parameter, and every variable of the name on the way up.
					for (const [owner, params] of parameterLists) {
						if (params.length === 0 || (view && inRegion(params[0].range[0]))) continue;
						const from = params[0].range[0], to = params.at(-1).range[1];
						const top = scopeAt(params[0]);
						void owner;
						for (const token of sourceCode.ast.tokens) {
							if (token.range[0] < from || token.range[0] >= to) continue;
							if (!((token.type === "Identifier" || token.type === "Keyword") && /^[\p{ID_Start}$_]/u.test(token.value))) continue;
							for (let s = top; s; s = s.upper) for (const v of s.variables) if (v.name === token.value) quirk.add(v);
						}
					}
					namedInParameters.length = 0;
				}
				for (const id of namedInParameters) {
					if (view && inRegion(id.range[0])) continue;
					for (let s = scopeAt(id); s; s = s.upper) { const v = s.variables.find(x => x.name === id.name); if (v) { quirk.add(v); break; } }
				}
				for (const scope of scopeManager.scopes) {
					if (scope.functionExpressionScope) continue;
					scope.variables.forEach((variable, index) => {
						const def = variable.defs[0];
						if (!def) return;
						if (view) {
							// declared inside what is not built, or by a specifier that the parse pass keeps no record of: no variable
							if (variable.defs.every(d => !d.name || !d.name.range || inRegion(d.name.range[0]) || inlineTypeImport(d))) return;
							if (view === "names" && weakNames.has(variable.name)) return;
						}
						if (quirk.has(variable) || isMarked(variable, scope)) return;
						if (variable.defs.some(d => d.type !== "Parameter" && exported.has(d.name.range[0]))) return;
						if (isUsed(variable)) return;
						if (def.type === "Parameter" && isPlainParameter(def) &&
							scope.variables.slice(index + 1).some(v => v.defs.some(d => d.type === "Parameter") && (refsOf(v).length > 0 || quirk.has(v) || isMarked(v, scope)))) return;
						const asType = refsOf(variable).some(onlyAsType);
						if (asType && variable.defs.some(d => d.type === "ImportBinding")) return;
						const writes = refsOf(variable).filter(ref => ref.isWrite() && ref.from.variableScope === scope.variableScope);
						const id = writes.length > 0 ? writes.at(-1).identifier : variable.identifiers[0];
						context.report({ node: id, loc: { start: id.loc.start, end: { line: id.loc.start.line, column: id.loc.start.column + 1 } }, messageId: asType ? "usedOnlyAsType" : "unusedVar", data: { varName: variable.name, action: refsOf(variable).some(ref => ref.isWrite()) ? "assigned a value" : "defined" } });
					});
				}
			},
		};
	},
};
