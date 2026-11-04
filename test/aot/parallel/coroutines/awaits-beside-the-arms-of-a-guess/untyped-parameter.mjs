class Keeper {
  constructor() { this.base = 1; }
  async fetchOne(key) { await null; return key + this.base; }
}
const stranger = (0, eval)("({ base: 100, async fetchOne(key) { await null; return 's' + (key + this.base); } })");
function missed(key) { return "missed " + key; }
async function byChoice(keeper, hit, key) { const got = await (hit ? keeper.fetchOne(key) : missed(key)); return typeof got + " " + String(got); }
async function byChain(keeper, key) { const got = await keeper?.fetchOne(key); return typeof got + " " + String(got); }
async function byAnd(keeper, key) { const got = await (keeper && keeper.fetchOne(key)); return typeof got + " " + String(got); }
for (let i = 0; i < 300; i++) { await byChoice(new Keeper(), i % 2 === 0, i); await byChain(i % 7 ? new Keeper() : undefined, i); await byAnd(i % 5 ? new Keeper() : 0, i); }
console.log(await byChoice(new Keeper(), true, 1), "|", await byChain(new Keeper(), 3), "|", await byAnd(new Keeper(), 5));
console.log(await byChoice(stranger, true, 2), "|", await byChain(stranger, 4), "|", await byAnd(stranger, 6));
