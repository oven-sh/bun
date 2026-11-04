// two sums: an element is undefined, in turn 6
class Links { kind: number; constructor(kind: number) { this.kind = kind; } }
class Sym { flags: number; links: Links; constructor(flags: number, links: Links) { this.flags = flags; this.links = links; } }
function spoiled(kind: number) { const links = new Links(kind); (links as any).kind = "k" + kind; return links; }
let calls = 0;
function run(list: Sym[]) { let even = 0; let odd = 0; for (let i = 0; i < list.length; i++) { if (i & 1) odd += list[i].links.kind; else even += list[i].links.kind; } return even + ":" + odd; }
function clean() { const list: Sym[] = []; for (let i = 0; i < 7; i++) list.push(new Sym(i, new Links(i * 2))); return list; }
function look(list: Sym[]) { let answer: unknown; try { answer = run(list); } catch (error) { answer = (error as Error).name; } console.log(String(answer), calls); }
const plain = clean();
for (let i = 0; i < 3; i++) look(plain);
{ const at = 6; const list = clean(); (list as any)[at] = undefined; look(list); look(list); }
look(plain);
