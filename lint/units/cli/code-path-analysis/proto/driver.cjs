// The code path analyzer of ESLint driven from a tree of Bun's shape (bunshape.cjs), with no parent pointers:
// what upstream reads from `node.parent` is said by the visit of the parent (a `role`), and what it reads from
// `node.type` is said by the visit of the node (a `kind`). CodePath, CodePathState, ForkContext, CodePathSegment and
// IdGenerator are upstream's own files: this file is the shape of code_path_analyzer.rs plus the calls of linter.rs.
"use strict";
const path = require("path");
const R = "/workspace/ref/eslint/lib/linter/code-path-analysis";
const CodePath = require(path.join(R, "code-path"));
const CodePathSegment = require(path.join(R, "code-path-segment"));
const IdGenerator = require(path.join(R, "id-generator"));

// ---------------------------------------------------------------------------------------------------------------
// code-path-analyzer.js, with `node.parent` and `node.type` replaced by arguments.
// ---------------------------------------------------------------------------------------------------------------
class CodePathAnalyzer {
	constructor(emit, options = {}) {
		this.emit = emit;
		this.codePath = null;
		this.idGenerator = new IdGenerator("s");
		this.currentNode = null;
		this.onLooped = this.onLooped.bind(this);
		this.options = options;
	}

	get state() {
		return CodePath.getState(this.codePath);
	}

	forwardCurrentToHead(node) {
		const state = this.state;
		const currentSegments = state.currentSegments;
		const headSegments = state.headSegments;
		const end = Math.max(currentSegments.length, headSegments.length);
		for (let i = 0; i < end; ++i) {
			const currentSegment = currentSegments[i];
			const headSegment = headSegments[i];
			if (currentSegment !== headSegment && currentSegment) {
				this.emit(currentSegment.reachable ? "onCodePathSegmentEnd" : "onUnreachableCodePathSegmentEnd", [currentSegment, node]);
			}
		}
		state.currentSegments = headSegments;
		for (let i = 0; i < end; ++i) {
			const currentSegment = currentSegments[i];
			const headSegment = headSegments[i];
			if (currentSegment !== headSegment && headSegment) {
				CodePathSegment.markUsed(headSegment);
				this.emit(headSegment.reachable ? "onCodePathSegmentStart" : "onUnreachableCodePathSegmentStart", [headSegment, node]);
			}
		}
	}

	leaveFromCurrentSegment(node) {
		const state = this.state;
		for (const currentSegment of state.currentSegments) {
			this.emit(currentSegment.reachable ? "onCodePathSegmentEnd" : "onUnreachableCodePathSegmentEnd", [currentSegment, node]);
		}
		state.currentSegments = [];
	}

	// `preprocess`: the switch on `parent.type` and on which child the node is.
	preprocess(role) {
		const state = this.state;
		switch (role && role.r) {
			case "OptionalCallFirstArgument":
			case "OptionalMemberProperty":
				state.makeOptionalRight();
				break;
			case "LogicalRight":
				state.makeLogicalRight();
				break;
			case "IfConsequent":
				state.makeIfConsequent();
				break;
			case "IfAlternate":
				state.makeIfAlternate();
				break;
			case "SwitchCaseFirstConsequent":
				state.makeSwitchCaseBody(false, role.isDefault);
				break;
			case "TryHandler":
				state.makeCatchBlock();
				break;
			case "TryFinalizer":
				state.makeFinallyBlock();
				break;
			case "WhileTest":
				state.makeWhileTest(role.test);
				break;
			case "WhileBody":
				state.makeWhileBody();
				break;
			case "DoWhileBody":
				state.makeDoWhileBody();
				break;
			case "DoWhileTest":
				state.makeDoWhileTest(role.test);
				break;
			case "ForTest":
				state.makeForTest(role.test);
				break;
			case "ForUpdate":
				state.makeForUpdate();
				break;
			case "ForBody":
				state.makeForBody();
				break;
			case "ForInOfLeft":
				state.makeForInOfLeft();
				break;
			case "ForInOfRight":
				state.makeForInOfRight();
				break;
			case "ForInOfBody":
				state.makeForInOfBody();
				break;
			case "AssignmentPatternRight":
				state.pushForkContext();
				state.forkBypassPath();
				state.forkPath();
				break;
			default:
				break;
		}
	}

	startCodePath(origin, node) {
		if (this.codePath) {
			this.forwardCurrentToHead(node);
		}
		this.codePath = new CodePath({ id: this.idGenerator.next(), origin, upper: this.codePath, onLooped: this.onLooped });
		this.emit("onCodePathStart", [this.codePath, node]);
	}

	// `processCodePathToEnter`: the switch on `node.type`.
	processCodePathToEnter(kind, node, isPropertyDefinitionValue) {
		if (isPropertyDefinitionValue) {
			this.startCodePath("class-field-initializer", node);
		}
		switch (kind && kind.k) {
			case "Program":
				this.startCodePath("program", node);
				break;
			case "Function":
				this.startCodePath("function", node);
				break;
			case "StaticBlock":
				this.startCodePath("class-static-block", node);
				break;
			case "ChainExpression":
				this.state.pushChainContext();
				break;
			case "OptionalCallOrMember":
				this.state.makeOptionalNode();
				break;
			case "Logical":
			case "LogicalAssignment":
				this.state.pushChoiceContext(kind.operator, kind.isForkingByTrueOrFalse);
				break;
			case "ConditionalOrIf":
				this.state.pushChoiceContext("test", false);
				break;
			case "Switch":
				this.state.pushSwitchContext(kind.hasCase, kind.label);
				break;
			case "Try":
				this.state.pushTryContext(kind.hasFinalizer);
				break;
			case "SwitchCase":
				if (!kind.isFirst) {
					this.state.forkPath();
				}
				break;
			case "Loop":
				this.state.pushLoopContext(kind.type, kind.label);
				break;
			case "Labeled":
				if (!kind.bodyIsBreakable) {
					this.state.pushBreakContext(false, kind.label);
				}
				break;
			default:
				break;
		}
		this.forwardCurrentToHead(node);
	}

	// `processCodePathToExit`: the switch on `node.type`.
	processCodePathToExit(kind, node) {
		const state = this.state;
		let dontForward = false;
		switch (kind && kind.k) {
			case "ChainExpression":
				state.popChainContext();
				break;
			case "ConditionalOrIf":
			case "Logical":
			case "LogicalAssignment":
				state.popChoiceContext();
				break;
			case "Switch":
				state.popSwitchContext();
				break;
			case "SwitchCase":
				if (kind.consequentIsEmpty) {
					state.makeSwitchCaseBody(true, kind.isDefault);
				}
				if (state.forkContext.reachable) {
					dontForward = true;
				}
				break;
			case "Try":
				state.popTryContext();
				break;
			case "Break":
				this.forwardCurrentToHead(node);
				state.makeBreak(kind.label);
				dontForward = true;
				break;
			case "Continue":
				this.forwardCurrentToHead(node);
				state.makeContinue(kind.label);
				dontForward = true;
				break;
			case "Return":
				this.forwardCurrentToHead(node);
				state.makeReturn();
				dontForward = true;
				break;
			case "Throw":
				this.forwardCurrentToHead(node);
				state.makeThrow();
				dontForward = true;
				break;
			case "IdentifierReference":
				state.makeFirstThrowablePathInTryOrCatchBlock();
				dontForward = true;
				break;
			case "Throwable":
				state.makeFirstThrowablePathInTryOrCatchBlock();
				break;
			case "Yield":
				state.makeYield();
				break;
			case "Loop":
				state.popLoopContext();
				break;
			case "AssignmentPattern":
				state.popForkContext();
				break;
			case "Labeled":
				if (!kind.bodyIsBreakable) {
					state.popBreakContext();
				}
				break;
			default:
				break;
		}
		if (!dontForward) {
			this.forwardCurrentToHead(node);
		}
	}

	endCodePath(node) {
		const codePath = this.codePath;
		CodePath.getState(codePath).makeFinal();
		this.leaveFromCurrentSegment(node);
		this.emit("onCodePathEnd", [codePath, node]);
		this.codePath = this.codePath.upper;
	}

	// `postprocess`.
	postprocess(kind, node, isPropertyDefinitionValue) {
		switch (kind && kind.k) {
			case "Program":
			case "Function":
			case "StaticBlock":
				this.endCodePath(node);
				break;
			case "OptionalCallWithoutArguments":
				this.state.makeOptionalRight();
				break;
			default:
				break;
		}
		if (isPropertyDefinitionValue) {
			this.endCodePath(node);
		}
	}

	onLooped(fromSegment, toSegment) {
		if (fromSegment.reachable && toSegment.reachable) {
			this.emit("onCodePathSegmentLoop", [fromSegment, toSegment, this.currentNode]);
		}
	}
}

// ---------------------------------------------------------------------------------------------------------------
// The walk: what linter.rs does around `walk::walk_*`. `probe(name, node)` stands for the handlers of the rules.
// ---------------------------------------------------------------------------------------------------------------
const PLAIN = null;
const LOGICAL = new Set(["&&", "||", "??"]);
const LOGICAL_ASSIGN = new Set(["&&=", "||=", "??="]);
const BREAKABLE = new Set(["SDoWhile", "SWhile", "SFor", "SForIn", "SForOf", "SSwitch"]);

class Driver {
	constructor(emit, probe, options = {}) {
		this.a = new CodePathAnalyzer(emit, options);
		this.probe = probe;
		this.options = options;
	}

	// enterNode: preprocess, processCodePathToEnter, then the handlers of the rules.
	enter(node, role, kind, flags) {
		const a = this.a;
		a.currentNode = node;
		// constructor-super reads whether the node of a segment event is the update of a `for`.
		if (role && role.r === "ForUpdate") node.isForUpdate = true;
		if (a.codePath) a.preprocess(role);
		a.processCodePathToEnter(kind, node, flags && flags.pdValue);
		this.probe("enter", node, kind);
		a.currentNode = null;
	}

	// leaveNode: processCodePathToExit, the handlers of the rules, postprocess.
	leave(node, kind, post, flags) {
		const a = this.a;
		a.currentNode = node;
		a.processCodePathToExit(kind, node);
		this.probe("exit", node, kind);
		a.postprocess(post || kind, node, flags && flags.pdValue);
		a.currentNode = null;
	}

	// A node that Bun's tree has no node for, and that ESTree has: its two ends are two forwards.
	virtual(name, src, role) {
		const node = { t: name, src, virtual: true };
		this.enter(node, role, PLAIN);
		return node;
	}

	// An ESTree `Identifier` that Bun's tree has no node for.
	identifier(src, isReference, role) {
		const node = { t: "Identifier", src, virtual: true };
		this.enter(node, role, PLAIN);
		this.leave(node, isReference ? { k: "IdentifierReference" } : PLAIN);
	}

	program(tree) {
		const node = { t: "Program", src: tree.src };
		this.enter(node, null, { k: "Program" });
		this.stmts(tree.stmts);
		this.leave(node, { k: "Program" });
	}

	stmts(list) {
		let prev = null;
		for (const s of list) {
			if (s.t === "SComment") continue;
			this.prevOfNext = prev;
			this.stmt(s, null);
			prev = s.exportNode || s;
		}
	}

	// `label`: the statement is the body of S::Label with that name (`getLabel`).
	stmt(s, role, label = null) {
		if (s.t === "SComment") return;
		const prev = this.prevOfNext || null;
		this.prevOfNext = null;
		// `export` before a declaration: ExportNamedDeclaration is a node of ESTree alone.
		let exportNode = null;
		if (s.is_export && s.export_src) {
			exportNode = { t: "ExportNamedDeclaration", src: s.export_src, virtual: true, inner: s, prevSibling: prev };
			s.exportNode = exportNode;
			this.enter(exportNode, role, PLAIN);
			role = null;
		} else {
			s.prevSibling = prev;
		}
		this.stmtInner(s, role, label);
		if (exportNode) this.leave(exportNode, PLAIN);
	}

	stmtInner(s, role, label) {
		switch (s.t) {
			case "SBlock":
				this.enter(s, role, PLAIN);
				this.stmts(s.stmts);
				this.leave(s, PLAIN);
				break;
			case "SExpr":
				this.enter(s, role, PLAIN);
				this.expr(s.value, null);
				this.leave(s, PLAIN);
				break;
			case "SDirective": {
				this.enter(s, role, PLAIN);
				this.leave(s, PLAIN);
				break;
			}
			case "SEmpty":
			case "SDebugger":
			case "SImport":
			case "SExportClause":
			case "SExportFrom":
			case "SExportStar":
				this.enter(s, role, PLAIN);
				this.leave(s, PLAIN);
				break;
			case "SLocal":
				this.enter(s, role, PLAIN);
				for (const d of s.decls) {
					const declarator = this.virtual("VariableDeclarator", d.src, null);
					this.binding(d.binding, null, false);
					if (d.value) this.expr(d.value, null);
					this.leave(declarator, PLAIN);
				}
				this.leave(s, PLAIN);
				break;
			case "SReturn":
				this.enter(s, role, PLAIN);
				if (s.value) this.expr(s.value, null);
				this.leave(s, { k: "Return" });
				break;
			case "SThrow":
				this.enter(s, role, PLAIN);
				this.expr(s.value, null);
				this.leave(s, { k: "Throw" });
				break;
			case "SBreak":
			case "SContinue":
				this.enter(s, role, PLAIN);
				if (s.label !== null) this.identifier(null, false, null);
				this.leave(s, { k: s.t === "SBreak" ? "Break" : "Continue", label: s.label });
				break;
			case "SIf":
				this.enter(s, role, { k: "ConditionalOrIf" });
				this.expr(s.test, null, { isTest: true });
				this.stmt(s.yes, { r: "IfConsequent" });
				if (s.no) this.stmt(s.no, { r: "IfAlternate" });
				this.leave(s, { k: "ConditionalOrIf" });
				break;
			case "SWhile":
				this.enter(s, role, { k: "Loop", type: "WhileStatement", label });
				this.expr(s.test, { r: "WhileTest", test: booleanValueIfSimpleConstant(s.test) }, { isTest: true });
				this.stmt(s.body, { r: "WhileBody" });
				this.leave(s, { k: "Loop" });
				break;
			case "SDoWhile":
				this.enter(s, role, { k: "Loop", type: "DoWhileStatement", label });
				this.stmt(s.body, { r: "DoWhileBody" });
				this.expr(s.test, { r: "DoWhileTest", test: booleanValueIfSimpleConstant(s.test) }, { isTest: true });
				this.leave(s, { k: "Loop" });
				break;
			case "SFor":
				this.enter(s, role, { k: "Loop", type: "ForStatement", label });
				if (s.init) {
					// An expression there is wrapped in S::SExpr by Bun alone: it is not a statement of ESTree.
					if (s.init.t === "SExpr") this.expr(s.init.value, null);
					else this.stmt(s.init, null);
				}
				if (s.test) this.expr(s.test, { r: "ForTest", test: booleanValueIfSimpleConstant(s.test) }, { isTest: true });
				if (s.update) this.expr(s.update, { r: "ForUpdate" });
				this.stmt(s.body, { r: "ForBody" });
				this.leave(s, { k: "Loop" });
				break;
			case "SForIn":
			case "SForOf":
				this.enter(s, role, { k: "Loop", type: s.t === "SForIn" ? "ForInStatement" : "ForOfStatement", label });
				if (s.init.t === "SExpr") this.expr(s.init.value, { r: "ForInOfLeft" });
				else this.stmt(s.init, { r: "ForInOfLeft" });
				this.expr(s.value, { r: "ForInOfRight" });
				this.stmt(s.body, { r: "ForInOfBody" });
				this.leave(s, { k: "Loop" });
				break;
			case "SSwitch": {
				this.enter(s, role, { k: "Switch", hasCase: s.cases.some(c => c.value !== null), label });
				this.expr(s.test, null);
				s.cases.forEach((c, i) => {
					const body = c.body.filter(x => x.t !== "SComment");
					const isDefault = c.value === null;
					const node = { t: "SwitchCase", src: c.src, case: c, virtual: true };
					this.enter(node, null, { k: "SwitchCase", isFirst: i === 0 });
					if (c.value) this.expr(c.value, null);
					body.forEach((x, j) => {
						this.prevOfNext = j === 0 ? null : body[j - 1].exportNode || body[j - 1];
						this.stmt(x, j === 0 ? { r: "SwitchCaseFirstConsequent", isDefault } : null);
					});
					this.leave(node, { k: "SwitchCase", consequentIsEmpty: body.length === 0, isDefault });
				});
				this.leave(s, { k: "Switch" });
				break;
			}
			case "STry": {
				this.enter(s, role, { k: "Try", hasFinalizer: s.finally !== null });
				const block = this.virtual("BlockStatement", s.body_src, null);
				this.stmts(s.body);
				this.leave(block, PLAIN);
				if (s.catch) {
					const handler = this.virtual("CatchClause", s.catch.src, { r: "TryHandler" });
					if (s.catch.binding) this.binding(s.catch.binding, null, false);
					const body = this.virtual("BlockStatement", s.catch.body_src, null);
					s.lastBlock = body;
					this.stmts(s.catch.body);
					this.leave(body, PLAIN);
					this.leave(handler, PLAIN);
				}
				if (s.finally) {
					const finalizer = this.virtual("BlockStatement", s.finally.src, { r: "TryFinalizer" });
					s.lastBlock = finalizer;
					this.stmts(s.finally.stmts);
					this.leave(finalizer, PLAIN);
				}
				this.leave(s, { k: "Try" });
				break;
			}
			case "SLabel": {
				const bodyIsBreakable = BREAKABLE.has(s.stmt.t);
				this.enter(s, role, { k: "Labeled", bodyIsBreakable, label: s.name });
				this.identifier(null, false, null);
				this.stmt(s.stmt, null, s.name);
				this.leave(s, { k: "Labeled", bodyIsBreakable });
				break;
			}
			case "SWith":
				this.enter(s, role, PLAIN);
				this.expr(s.value, null);
				this.stmt(s.body, null);
				this.leave(s, PLAIN);
				break;
			case "SFunction":
				this.func(s, s.func, role, null);
				break;
			case "SClass":
				this.enter(s, role, PLAIN);
				this.klass(s.class);
				this.leave(s, PLAIN);
				break;
			case "SExportDefault":
				this.enter(s, role, PLAIN);
				if (s.value.stmt) this.stmt(s.value.stmt, null);
				else this.expr(s.value.expr, null);
				this.leave(s, PLAIN);
				break;
			default:
				throw new Error(`stmt ${s.t}`);
		}
	}

	// S::Function, E::Function and E::Arrow: one code path each.
	func(node, f, role, flags) {
		this.enter(node, role, { k: "Function" }, flags);
		if (f.name) this.identifier(f.name, false, null);
		for (const arg of f.args) {
			if (arg.default) {
				const pattern = this.virtual("AssignmentPattern", arg.src, null);
				this.binding(arg.binding, null, true);
				this.expr(arg.default, { r: "AssignmentPatternRight" });
				this.leave(pattern, { k: "AssignmentPattern" });
			} else if (arg.rest) {
				const rest = this.virtual("RestElement", arg.src, null);
				this.binding(arg.binding, null, false);
				this.leave(rest, PLAIN);
			} else {
				// A parameter that is a name: `parent.id !== node`, a reference for upstream.
				this.binding(arg.binding, null, true);
			}
		}
		if (node.t === "EArrow" && node.prefer_expr) {
			// The body is one S::Return that ESTree does not have: the expression is the body.
			this.expr(f.body.stmts[0].value, null);
		} else {
			const block = this.virtual("BlockStatement", f.body.src, null);
			this.stmts(f.body.stmts);
			this.leave(block, PLAIN);
		}
		this.leave(node, { k: "Function" }, null, flags);
	}

	klass(c) {
		if (c.class_name) this.identifier(c.class_name, false, null);
		if (c.extends) this.expr(c.extends, null);
		const body = this.virtual("ClassBody", c.body_src, null);
		for (const p of c.properties) {
			if (p.kind === "class_static_block") {
				const node = { t: "StaticBlock", src: p.src, virtual: true };
				this.enter(node, null, { k: "StaticBlock" });
				this.stmts(p.class_static_block.stmts);
				this.leave(node, { k: "StaticBlock" });
				continue;
			}
			const member = { t: p.is_method ? "MethodDefinition" : "PropertyDefinition", src: p.src, virtual: true, property: p, klass: c };
			this.enter(member, null, PLAIN);
			this.key(p, false);
			if (p.is_method) this.expr(p.value, null);
			else if (p.initializer) this.expr(p.initializer, null, { pdValue: p.kind !== "auto_accessor" });
			this.leave(member, PLAIN);
		}
		this.leave(body, PLAIN);
	}

	// The key of a property: a computed one is an expression, another one is a name or a literal that may have no node.
	key(p, isShorthand) {
		if (p.is_computed) {
			this.expr(p.key, null);
		} else if (p.key.t === "EString" && (p.key.from_identifier || this.options.stringKeyAsIdentifier)) {
			this.identifier(p.key.src, isShorthand, null);
		} else {
			this.expr(p.key, null);
		}
	}

	// `isReference`: what `isIdentifierReference` answers for a name at this place.
	binding(b, role, isReference) {
		switch (b.t) {
			case "BMissing":
				break;
			case "BIdentifier":
				this.enter(b, role, PLAIN);
				this.leave(b, isReference ? { k: "IdentifierReference" } : PLAIN);
				break;
			case "BArray":
				this.enter(b, role, PLAIN);
				for (const item of b.items) {
					if (item.default_value) {
						const pattern = this.virtual("AssignmentPattern", item.src, null);
						this.binding(item.binding, null, true);
						this.expr(item.default_value, { r: "AssignmentPatternRight" });
						this.leave(pattern, { k: "AssignmentPattern" });
					} else if (item.rest) {
						const rest = this.virtual("RestElement", item.src, null);
						this.binding(item.binding, null, false);
						this.leave(rest, PLAIN);
					} else {
						this.binding(item.binding, null, false);
					}
				}
				this.leave(b, PLAIN);
				break;
			case "BObject":
				this.enter(b, role, PLAIN);
				for (const p of b.properties) {
					if (p.is_spread) {
						const rest = this.virtual("RestElement", p.src, null);
						this.binding(p.value, null, false);
						this.leave(rest, PLAIN);
						continue;
					}
					const property = this.virtual("Property", p.src, null);
					// `{ a }` and `{ a = 1 }`: the key and the value start at one place.
					this.key(p, !p.is_computed && p.key.at === p.value.at);
					if (p.default_value) {
						const pattern = this.virtual("AssignmentPattern", p.default_src, null);
						this.binding(p.value, null, true);
						this.expr(p.default_value, { r: "AssignmentPatternRight" });
						this.leave(pattern, { k: "AssignmentPattern" });
					} else {
						this.binding(p.value, null, true);
					}
					this.leave(property, PLAIN);
				}
				this.leave(b, PLAIN);
				break;
			default:
				throw new Error(`binding ${b.t}`);
		}
	}

	// flags: isTest (the `test` of a conditional, an `if` or a loop), inLogical (an operand of `&&`, `||`, `??` or of
	// their assignments), inChain (the object or the callee of a link of the same chain), notReference (a name that is an
	// element of an array pattern or the argument of a rest element), pdValue (the value of a class field), jsxName.
	expr(e, role, flags = {}) {
		const pd = flags.pdValue ? { pdValue: true } : null;
		switch (e.t) {
			case "EMissing":
				break;
			case "EIdentifier":
				this.enter(e, role, PLAIN, pd);
				this.leave(e, flags.notReference || flags.jsxName ? PLAIN : { k: "IdentifierReference" }, null, pd);
				break;
			case "ENewTarget":
			case "EImportMeta":
				this.enter(e, role, PLAIN, pd);
				this.identifier(null, true, null);
				this.identifier(null, true, null);
				this.leave(e, PLAIN, null, pd);
				break;
			case "EString":
			case "ENumber":
			case "EBigInt":
			case "EBoolean":
			case "ENull":
			case "ERegExp":
			case "EThis":
			case "ESuper":
			case "EPrivateIdentifier":
				this.enter(e, role, PLAIN, pd);
				this.leave(e, PLAIN, null, pd);
				break;
			case "EArray":
				this.enter(e, role, PLAIN, pd);
				for (const item of e.items) this.expr(item, null, { notReference: e.is_target });
				this.leave(e, PLAIN, null, pd);
				break;
			case "EObject":
				this.enter(e, role, PLAIN, pd);
				for (const p of e.properties) {
					if (p.kind === "spread") {
						const spread = this.virtual(e.is_target ? "RestElement" : "SpreadElement", p.src, null);
						this.expr(p.value, null, { notReference: e.is_target });
						this.leave(spread, PLAIN);
						continue;
					}
					const property = this.virtual("Property", p.src, null);
					this.key(p, !!p.was_shorthand);
					if (p.initializer) {
						const pattern = this.virtual("AssignmentPattern", p.default_src, null);
						this.expr(p.value, null);
						this.expr(p.initializer, { r: "AssignmentPatternRight" });
						this.leave(pattern, { k: "AssignmentPattern" });
					} else {
						this.expr(p.value, null);
					}
					this.leave(property, PLAIN);
				}
				this.leave(e, PLAIN, null, pd);
				break;
			case "ESpread":
				this.enter(e, role, PLAIN, pd);
				this.expr(e.value, null, { notReference: !!e.is_rest });
				this.leave(e, PLAIN, null, pd);
				break;
			case "EUnary":
			case "EAwait":
				this.enter(e, role, PLAIN, pd);
				this.expr(e.value, null);
				this.leave(e, PLAIN, null, pd);
				break;
			case "EYield":
				this.enter(e, role, PLAIN, pd);
				if (e.value) this.expr(e.value, null);
				this.leave(e, { k: "Yield" }, null, pd);
				break;
			case "EBinary":
				this.binary(e, role, flags, pd);
				break;
			case "EIf":
				this.enter(e, role, { k: "ConditionalOrIf" }, pd);
				this.expr(e.test, null, { isTest: true });
				this.expr(e.yes, { r: "IfConsequent" });
				this.expr(e.no, { r: "IfAlternate" });
				this.leave(e, { k: "ConditionalOrIf" }, null, pd);
				break;
			case "ENew":
				this.enter(e, role, PLAIN, pd);
				this.expr(e.target, null);
				for (const arg of e.args) this.expr(arg, null);
				this.leave(e, { k: "Throwable" }, null, pd);
				break;
			case "EImport":
				this.enter(e, role, PLAIN, pd);
				this.expr(e.expr, null);
				this.expr(e.options, null);
				this.leave(e, { k: "Throwable" }, null, pd);
				break;
			case "ECall":
			case "EDot":
			case "EIndex":
				this.link(e, role, flags, pd);
				break;
			case "ETemplate":
				this.enter(e, role, PLAIN, pd);
				if (e.tag) {
					this.expr(e.tag, null);
					const quasi = this.virtual("TemplateLiteral", null, null);
					for (const part of e.parts) this.expr(part.value, null);
					this.leave(quasi, PLAIN);
				} else {
					for (const part of e.parts) this.expr(part.value, null);
				}
				this.leave(e, PLAIN, null, pd);
				break;
			case "EFunction":
			case "EArrow":
				this.func(e, e.t === "EArrow" ? e : e.func, role, pd);
				break;
			case "EClass":
				this.enter(e, role, PLAIN, pd);
				this.klass(e.class);
				this.leave(e, PLAIN, null, pd);
				break;
			case "EJSXElement":
				this.enter(e, role, PLAIN, pd);
				if (e.tag) this.expr(e.tag, null, { jsxName: true });
				for (const p of e.properties) {
					if (p.value) this.expr(p.value, null);
				}
				for (const child of e.children) this.expr(child, null);
				this.leave(e, PLAIN, null, pd);
				break;
			default:
				throw new Error(`expr ${e.t}`);
		}
	}

	// E::Binary: an operator, an assignment, `&&` `||` `??` and their assignments, a default in a pattern, a comma.
	// The left operand is walked before the right one: walk::walk_e_binary has the other order.
	binary(e, role, flags, pd) {
		const isForkingByTrueOrFalse = !!(flags.isTest || flags.inLogical);
		if (LOGICAL.has(e.op) || LOGICAL_ASSIGN.has(e.op)) {
			const isAssign = LOGICAL_ASSIGN.has(e.op);
			const kind = { k: isAssign ? "LogicalAssignment" : "Logical", operator: isAssign ? e.op.slice(0, -1) : e.op, isForkingByTrueOrFalse };
			this.enter(e, role, kind, pd);
			this.expr(e.left, null, { inLogical: true });
			this.expr(e.right, { r: "LogicalRight" }, { inLogical: true });
			this.leave(e, kind, null, pd);
		} else if (e.op === "=" && e.is_default) {
			this.enter(e, role, PLAIN, pd);
			this.expr(e.left, null);
			this.expr(e.right, { r: "AssignmentPatternRight" });
			this.leave(e, { k: "AssignmentPattern" }, null, pd);
		} else {
			this.enter(e, role, PLAIN, pd);
			this.expr(e.left, null);
			this.expr(e.right, null);
			this.leave(e, PLAIN, null, pd);
		}
	}

	// E::Call, E::Dot and E::Index: a link of an optional chain when `optional_chain` is set.
	link(e, role, flags, pd) {
		// The outermost link of a chain is where ESTree has a ChainExpression: the role and the field value are its.
		const isChainRoot = e.optional_chain !== null && !flags.inChain;
		let chain = null;
		if (isChainRoot) {
			chain = { t: "ChainExpression", src: null, virtual: true };
			this.enter(chain, role, { k: "ChainExpression" }, pd);
			role = null;
			pd = null;
		}
		const isOptional = e.optional_chain === "start";
		const targetFlags = { inChain: e.optional_chain !== null && isLinkOfSameChain(e.target), jsxName: flags.jsxName };
		this.enter(e, role, isOptional ? { k: "OptionalCallOrMember" } : PLAIN, pd);
		if (e.t === "ECall" && e.target.t === "ESuper") e.target.isCallee = true;
		this.expr(e.target, null, targetFlags);
		if (e.t === "ECall") {
			e.args.forEach((arg, i) => this.expr(arg, isOptional && i === 0 ? { r: "OptionalCallFirstArgument" } : null));
			this.leave(e, { k: "Throwable" }, isOptional && e.args.length === 0 ? { k: "OptionalCallWithoutArguments" } : PLAIN, pd);
		} else if (e.t === "EIndex") {
			this.expr(e.index, isOptional ? { r: "OptionalMemberProperty" } : null);
			this.leave(e, flags.jsxName ? PLAIN : { k: "Throwable" }, PLAIN, pd);
		} else {
			// The name after the dot is an Identifier of ESTree, and a reference for upstream.
			if (flags.jsxName) this.identifier(e.name_src, false, null);
			else this.identifier(e.name_src, true, isOptional ? { r: "OptionalMemberProperty" } : null);
			this.leave(e, flags.jsxName ? PLAIN : { k: "Throwable" }, PLAIN, pd);
		}
		if (chain) this.leave(chain, { k: "ChainExpression" }, PLAIN, flags.pdValue ? { pdValue: true } : null);
	}
}

// Whether `target` goes on the chain of its parent: it is a link with `optional_chain` set. A parenthesized chain has
// it set too and is a chain of its own: the side table says so in Bun, `paren` says so here.
function isLinkOfSameChain(target) {
	return (target.t === "ECall" || target.t === "EDot" || target.t === "EIndex") && target.optional_chain !== null && !target.paren;
}

// `getBooleanValueIfSimpleConstant`: `Boolean(node.value)` of a Literal, `undefined` for every other node.
function booleanValueIfSimpleConstant(e) {
	switch (e.t) {
		case "EBoolean":
			return e.value;
		case "ENumber":
			return Boolean(e.value);
		case "EString":
			return e.prefer_template ? void 0 : e.value.length > 0;
		case "ENull":
			return false;
		case "EBigInt":
			return /[1-9a-fA-F]/u.test(e.value.replace(/^0[xXoObB]/u, ""));
		case "ERegExp":
			return true;
		default:
			return void 0;
	}
}

module.exports = { Driver, CodePathAnalyzer };
