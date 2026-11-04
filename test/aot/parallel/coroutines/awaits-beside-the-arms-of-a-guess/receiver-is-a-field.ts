class Keeper {
  base = 1;
  async fetchOne(key: number): Promise<unknown> { await null; return key + this.base; }
}
const stranger = (0, eval)("({ base: 100, async fetchOne(key) { await null; return String.fromCharCode(115) + (key + this.base); } })");
const unseen = (0, eval)("(x) => x");
function missed(key: number): unknown { return "missed " + key; }
class Desk { keeper: Keeper = new Keeper(); }
async function byChoice(desk: Desk, hit: boolean, key: number) { const got = await (hit ? desk.keeper.fetchOne(key) : missed(key)); return typeof got + " " + String(got); }
async function byChain(desk: Desk, key: number) { const got = await desk.keeper?.fetchOne(key); return typeof got + " " + String(got); }
const desk = new Desk();
for (let i = 0; i < 300; i++) { await byChoice(desk, i % 2 === 0, i); await byChain(desk, i); }
console.log(await byChoice(desk, true, 1), "|", await byChain(desk, 3));
(0, eval)("(d, s) => { d.keeper = s; }")(desk, stranger);
console.log(await byChoice(desk, true, 2), "|", await byChain(desk, 4));
