// in front of the test that fails in a turn an element of a list of the module is counted up: once a turn, whichever copy of the loop does the turn
class Links { kind: number; constructor(kind: number) { this.kind = kind; } }
class Sym { flags: number; links: Links; constructor(flags: number, links: Links) { this.flags = flags; this.links = links; } }
const cells = [0, 0];
function spoiled(kind: number) { const links = new Links(kind); (links as any).kind = "k" + kind; return links; }
function run(list: Sym[]) { let total = 0; let last = "";  for (let i = 0; i < list.length; i++) { const s = list[i]; cells[1] = cells[1] + 1; total += s.links.kind; } return total; }
function clean() { const list: Sym[] = []; for (let i = 0; i < 7; i++) list.push(new Sym(i, new Links(i * 2))); return list; }
function look(list: Sym[]) { let answer: unknown; try { answer = run(list); } catch (error) { answer = (error as Error).name; } console.log(String(answer), cells[1]); }
const plain = clean();
for (let i = 0; i < 3; i++) look(plain);
for (const at of [0, 3, 6]) { const list = clean(); list[at] = new Sym(at, spoiled(at)); look(list); look(list); }
for (const at of [0, 3, 6]) { const list = clean(); list[at] = JSON.parse(`{"flags":${at},"links":{"kind":${at * 2}}}`); look(list); look(list); }
look(plain);
