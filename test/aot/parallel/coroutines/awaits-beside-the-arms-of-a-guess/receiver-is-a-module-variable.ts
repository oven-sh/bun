class Keeper {
  base = 1;
  async fetchOne(key: number): Promise<unknown> { await null; return key + this.base; }
}
const stranger = (0, eval)("({ base: 100, async fetchOne(key) { await null; return String.fromCharCode(115) + (key + this.base); } })");
const unseen = (0, eval)("(x) => x");
function missed(key: number): unknown { return "missed " + key; }
let current: Keeper = new Keeper();
async function byChoice(hit: boolean, key: number) { const got = await (hit ? current.fetchOne(key) : missed(key)); return typeof got + " " + String(got); }
async function byChain(key: number) { const got = await current?.fetchOne(key); return typeof got + " " + String(got); }
for (let i = 0; i < 300; i++) { await byChoice(i % 2 === 0, i); await byChain(i); }
console.log(await byChoice(true, 1), "|", await byChain(3));
current = stranger as Keeper;
console.log(await byChoice(true, 2), "|", await byChain(4));
