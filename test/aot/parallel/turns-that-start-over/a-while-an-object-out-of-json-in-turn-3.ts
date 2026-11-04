// a while: an element was parsed out of a text, in turn 3
class Links { kind: number; constructor(kind: number) { this.kind = kind; } }
class Sym { flags: number; links: Links; constructor(flags: number, links: Links) { this.flags = flags; this.links = links; } }
function spoiled(kind: number) { const links = new Links(kind); (links as any).kind = "k" + kind; return links; }
let calls = 0;
function run(list: Sym[]) { let total = 0; let i = 0; while (i < list.length) { total += list[i].links.kind; i++; } return total; }
function clean() { const list: Sym[] = []; for (let i = 0; i < 7; i++) list.push(new Sym(i, new Links(i * 2))); return list; }
function look(list: Sym[]) { let answer: unknown; try { answer = run(list); } catch (error) { answer = (error as Error).name; } console.log(String(answer), calls); }
const plain = clean();
for (let i = 0; i < 3; i++) look(plain);
{ const at = 3; const list = clean(); list[at] = JSON.parse(`{"flags":${at},"links":{"kind":${at + 20}}}`); look(list); look(list); }
look(plain);
