// objects get fields that their constructor left out, under a handler, with a collection between the stores: each field is there behind its store, in the order of the stores
class Grown { declare a?: number; declare b?: string; declare c?: object; id: number; constructor(id: number) { this.id = id; } }
function subject(g: Grown, collect: boolean) { try { g.a = g.id; if (collect) Bun.gc(true); g.b = "b" + g.id; g.c = { of: g.id }; } catch (e) { return "caught"; } return Object.keys(g).join() + JSON.stringify(g); }
function deed(id: number, collect: boolean) { return subject(new Grown(id), collect); }
console.log(deed(1, false));
console.log(deed(2, true));
const kept: Grown[] = [];
let text = "";
for (let i = 0; i < 300; i++) { const g = new Grown(i); kept.push(g); const shown = subject(g, i % 100 === 0); if (i % 100 === 0) text += shown + ";"; }
console.log(text);
Bun.gc(true);
console.log(JSON.stringify(kept[299]) + JSON.stringify(kept[0]));
