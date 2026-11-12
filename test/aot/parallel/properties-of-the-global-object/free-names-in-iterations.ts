// Free names and symbols of globalThis in loops: declared variables, names that are absent, names that a script shadows, registered and created symbols.
import vm from "node:vm";
declare var total: any, scale: any, missing: any, shadowed: any, last: any, gone: any, hidden: any, kept: any;
const g: any = globalThis;
const xs: number[] = JSON.parse("[" + Array.from({ length: 24 }, (_, k) => (k * 37) % 11).join() + "]");
const late: any[] = JSON.parse('[1,2,3,4,5,6,7,8,9,10,"eleven",12,13]');
const REGISTERED = Symbol.for("app.state"), CREATED = Symbol("created");
function show(name: string, names: (string | symbol)[], run: (round: number) => unknown): void {
  const said: string[] = [];
  for (let round = 0; round < 4; round++) {
    try { said.push(String(run(round))); } catch (error) { said.push((error as Error).name); }
    said.push(names.map(key => String(g[key as string])).join());
  }
  console.log(name, said.join(" "));
}
g.total = 0; g.scale = 3;
show("added up", ["total"], () => { let s = 0; for (let i = 0; i < xs.length; i++) { total += xs[i]!; s = (s + xs[i]! * scale) | 0; } return s; });
show("absent", ["missing"], round => { let s = 0; for (let i = 0; i < xs.length; i++) { s += xs[i]!; if (i === 5 && round === 2) g.missing = 7; s = (s + missing) | 0; } return s; });
show("typeof", ["gone"], round => { let s = 0; for (let i = 0; i < xs.length; i++) { if (typeof gone === "undefined") s += 2; else s = (s + gone) | 0; if (i === 9) round & 1 ? delete g.gone : (g.gone = i); } return s; });
show("stored into what is absent", ["last"], round => { let s = 0; for (let i = 0; i < xs.length; i++) { s = (s + xs[i]!) | 0; if (round > 1 || i > 30) { g.last ??= 0; last = s; } } return s; });
g.shadowed = 1;
show("shadowed by a script", ["shadowed"], round => { let s = 0; for (let i = 0; i < xs.length; i++) { s = (s + shadowed) | 0; shadowed = i; if (i === 7 && round === 1) vm.runInThisContext("let shadowed = 100;"); } return s + "," + shadowed; });
g.hidden = 1; g.kept = 0;
function readsHidden() { let s = 0; for (let i = 0; i < xs.length; i++) { s = (s + hidden) | 0; kept = i; } return s; }
function storesHidden() { let s = 0; for (let i = 0; i < xs.length; i++) { hidden = i; s = (s + xs[i]!) | 0; } return s; }
show("hidden between the loops", ["hidden", "kept"], round => { if (round === 2) vm.runInThisContext("let hidden = 100;"); return readsHidden() + "," + storesHidden() + "," + hidden; });
show("written back", ["total"], () => { let s = 0; for (let i = 0; i < late.length; i++) { total += 0.5; s = (s + late[i]) | 0; } return s; });
show("registered symbol", [REGISTERED], () => { let s = 0; for (let i = 0; i < xs.length; i++) { g[REGISTERED] = (g[REGISTERED] ?? 0) + xs[i]!; s = (s + g[REGISTERED]) | 0; } return s; });
show("created symbol", [CREATED], round => { let s: any = 0; for (let i = 0; i < late.length; i++) { g[CREATED] = late[i]; s = (s + g[CREATED]) | 0; if (i === 4 && round === 1) Object.defineProperty(g, CREATED, { configurable: true, get: () => 5, set: () => { s += 1000; } }); } return s; });
function inline(x: number) { total = x; return total + scale; }
show("in a copied callee", ["total"], round => { let s = 0; for (let i = 0; i < late.length; i++) s = (s + inline(late[i])) | 0; if (round === 1) g.scale = "4"; return s; });
