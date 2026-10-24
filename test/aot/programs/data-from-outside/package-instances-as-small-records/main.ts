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
