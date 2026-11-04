// behind the test that fails in a turn Reflect.set() counts a property up: once a turn, whichever copy of the loop does the turn
class Links { kind: number; constructor(kind: number) { this.kind = kind; } }
class Sym { flags: number; links: Links; constructor(flags: number, links: Links) { this.flags = flags; this.links = links; } }
const record = { n: 0 };
function spoiled(kind: number) { const links = new Links(kind); (links as any).kind = "k" + kind; return links; }
const seven = new Uint8Array(7);
function run(list: Sym[], bytes: Uint8Array = seven) { let total = 0; let last = "";  for (let i = 0; i < bytes.length; i++) { const s = list[i]; total += s.links.kind; Reflect.set(record, "n", record.n + 1); } return total; }
function clean() { const list: Sym[] = []; for (let i = 0; i < 7; i++) list.push(new Sym(i, new Links(i * 2))); return list; }
function look(list: Sym[]) { let answer: unknown; try { answer = run(list); } catch (error) { answer = (error as Error).name; } console.log(String(answer), record.n); }
const plain = clean();
for (let i = 0; i < 3; i++) look(plain);
for (const at of [0, 3, 6]) { const list = clean(); list[at] = new Sym(at, spoiled(at)); look(list); look(list); }
for (const at of [0, 3, 6]) { const list = clean(); list[at] = JSON.parse(`{"flags":${at},"links":{"kind":${at * 2}}}`); look(list); look(list); }
look(plain);
