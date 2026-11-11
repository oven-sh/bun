// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 2
// CHECK-LABEL: function {{*}}name="narrow"
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK-LABEL: function {{*}}name="Keeper"
// CHECK-LABEL: function {{*}}name="visit"

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
