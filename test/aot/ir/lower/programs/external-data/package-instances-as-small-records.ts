// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 2

// FILE: main.ts
// A package written in JavaScript hands out instances of its own class, and its declaration file describes them by interfaces. The program holds them to smaller record types that it writes itself. The instances have every member, so they satisfy those types, the nested one too.
import type { ArrowFunctionExpression } from "./parser.js";
import * as parser from "./parser.js";
import * as walk from "./walker.js";
type Small = { async: boolean; expression: boolean; body: { start: number; end: number } };
type Span = { start: number; end: number };
function show(node: Small): string { return node.async + " " + node.expression + " " + node.body.start + " " + node.body.end; }
function span(node: Span): string { return node.start + ".." + node.end; }
class Keeper { kept: Small | undefined = undefined; keep(node: Small): void { this.kept = node; } }
function first(): ArrowFunctionExpression { return parser.parse("() => {}").body[0] as ArrowFunctionExpression; }
function narrow(): Small { return first(); }
function attempt(name: string, f: () => string): void { try { console.log(name, f()); } catch (e) { console.log(name, (e as Error).name + ": " + (e as Error).message.split("\n").slice(0, 2).join(" | ").replace(/ \(bun compile[^)]*\)/, "").slice(0, 170)); } }
attempt("a method of a visitor literal:", () => { let out = ""; walk.simple(parser.parse("() => {}"), { ArrowFunctionExpression(node: Small) { out += show(node); } }); return out; });
attempt("an arrow in a visitor literal:", () => { let out = ""; walk.simple(parser.parse("() => {}"), { ArrowFunctionExpression: (node: Small) => { out += show(node); } }); return out; });
attempt("a function by its name in a visitor literal:", () => { let out = ""; function visit(node: Small): void { out += show(node); } walk.simple(parser.parse("() => {}"), { ArrowFunctionExpression: visit }); return out; });
attempt("a visitor held in a variable:", () => { let out = ""; const visitors = { ArrowFunctionExpression(node: Small) { out += show(node); } }; walk.simple(parser.parse("() => {}"), visitors); return out; });
attempt("a visitor handed to a class of the package:", () => { let out = ""; new walk.Walker({ ArrowFunctionExpression(node: Small) { out += show(node); } }).run(parser.parse("() => {}")); return out; });
attempt("a callback with a smaller record:", () => { let out = ""; walk.each(parser.parse("() => {}"), (node: Span) => { out += span(node) + " "; }); return out; });
attempt("an argument:", () => show(first()));
attempt("a variable:", () => { const held: Small = first(); return show(held); });
attempt("a result:", () => show(narrow()));
attempt("a field:", () => { const keeper = new Keeper(); keeper.keep(first()); return show(keeper.kept!); });
attempt("an element:", () => { const list: Small[] = [first()]; return show(list[0]); });
attempt("a member of a literal:", () => { const holder: { node: Small } = { node: first() }; return show(holder.node); });
attempt("the inner one alone:", () => span(first().body));
attempt("identity:", () => { const given = first(); const held: Small = given; return String((held as unknown) === (given as unknown)); });
attempt("a literal of the type:", () => show({ async: true, expression: false, body: { start: 1, end: 2 } }));
walk.later(first()).then((node: Small) => console.log("a promise's callback:", show(node)), (e: Error) => console.log("a promise's callback:", e.name, e.message.split("\n")[0].slice(0, 120)));

// FILE: parser.d.ts
export interface Node { type: string; start: number; end: number }
export interface BlockStatement extends Node { type: "BlockStatement" }
export interface ArrowFunctionExpression extends Node { type: "ArrowFunctionExpression"; async: boolean; expression: boolean; body: BlockStatement }
export interface Program extends Node { type: "Program"; body: Node[] }
export function parse(text: string): Program;

// FILE: parser.js
export class Node { constructor(type, start, end) { this.type = type; this.start = start; this.end = end; } }
export function parse(text) {
  const body = new Node("BlockStatement", 6, text.length);
  const arrow = new Node("ArrowFunctionExpression", 0, text.length); arrow.async = false; arrow.expression = false; arrow.body = body;
  const program = new Node("Program", 0, text.length); program.body = [arrow];
  return program;
}

// FILE: walker.d.ts
import type * as parser from "./parser.js";
export type SimpleVisitors = { ArrowFunctionExpression?: (node: parser.ArrowFunctionExpression) => void; BlockStatement?: (node: parser.BlockStatement) => void; Program?: (node: parser.Program) => void };
export function simple(node: parser.Node, visitors: SimpleVisitors): void;
export function each(node: parser.Node, visit: (node: parser.Node) => void): void;
export function later<T extends parser.Node>(node: T): Promise<T>;
export class Walker { constructor(visitors: SimpleVisitors); run(node: parser.Node): void }

// FILE: walker.js
export function simple(node, visitors) {
  const visit = visitors[node.type]; if (visit) visit(node);
  if (Array.isArray(node.body)) for (const child of node.body) simple(child, visitors); else if (node.body) simple(node.body, visitors);
}
export function each(node, visit) { visit(node); if (Array.isArray(node.body)) for (const child of node.body) each(child, visit); else if (node.body) each(node.body, visit); }
export function later(node) { return Promise.resolve(node); }
export class Walker { constructor(visitors) { this.visitors = visitors; } run(node) { simple(node, this.visitors); } }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: narrow attempt Keeper visit
// CHECK-LABEL: function {{*}}name="narrow"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v1 = Call v0 calleeName="first"
// CHECK-NEXT: ReturnCall v1 casts=[{declared={type=undefined|null|[[L_4]] flags=[IsExpected]}}, {declared={type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_6]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_6]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = Call v1 calleeName="f"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v9 = Call v6, v4, v0, v8 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v10 = CatchValue
// CHECK-NEXT: v11 = Builtin builtin=GlobalThis
// CHECK-NEXT: v12 = PropGet v11 key="console" [isFreeName]
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="log"
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v16 = Convert v10 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v17 = PropGet v16 key="name"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string site=[[w_9]]} illTypedCause=Assertion
// CHECK-NEXT: v19 = String string=": "
// CHECK-NEXT: v20 = Add v18, v19
// CHECK-NEXT: v21 = PropGet v16 key="message"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|string site=[[w_10]]} illTypedCause=Assertion
// CHECK-NEXT: v23 = PropGet v22 key="split"
// CHECK-NEXT: v24 = String string="\n"
// CHECK-NEXT: v25 = Call v23, v22, v24 calleeKey="split" calleeName="e.message.split"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|Array<undefined|null|string> site=[[w_11]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v27 = PropGet v26 key="slice"
// CHECK-NEXT: v28 = Integer
// CHECK-NEXT: v29 = Integer integer=2
// CHECK-NEXT: v30 = Call v27, v26, v28, v29 calleeKey="slice" calleeName="slice"
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|Array<undefined|null|string> site=[[w_11]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v32 = PropGet v31 key="join"
// CHECK-NEXT: v33 = String string=" | "
// CHECK-NEXT: v34 = Call v32, v31, v33 calleeKey="join" calleeName="join"
// CHECK-NEXT: v35 = Convert v34 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v36 = PropGet v35 key="replace"
// CHECK-NEXT: v37 = NewRegExp pattern=" \\(bun compile[^)]*\\)"
// CHECK-NEXT: v38 = String string=""
// CHECK-NEXT: v39 = Call v36, v35, v37, v38 calleeKey="replace" calleeName="replace"
// CHECK-NEXT: v40 = Convert v39 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v41 = PropGet v40 key="slice"
// CHECK-NEXT: v42 = Integer
// CHECK-NEXT: v43 = Integer integer=170
// CHECK-NEXT: v44 = Call v41, v40, v42, v43 calleeKey="slice" calleeName="slice"
// CHECK-NEXT: v45 = Convert v44 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v46 = Add v20, v45
// CHECK-NEXT: v47 = Call v15, v13, v0, v46 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v48 = Undefined
// CHECK-NEXT: Return v48
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Keeper"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_12]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_12]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_12]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_13]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="visit"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 captures=[{type=env [[L_14]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] functionTypes={{*}}[[f_16]]] {
// CHECK-NEXT: b0(v0: env [[L_14]], v1: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetEnvironmentField v0 layout=[[L_14]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="out"
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_17]]
// CHECK-NEXT: v5 = Call v4, -, v1 calleeName="show"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string site=[[w_18]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v7 = Add v3, v6
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string site=[[w_19]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v9 = GetEnvironmentField v0 layout=[[L_14]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="out"
// CHECK-NEXT: PutEnvironmentField v0, v8 layout=[[L_14]]
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
