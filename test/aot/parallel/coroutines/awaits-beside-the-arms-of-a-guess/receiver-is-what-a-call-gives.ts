class Keeper {
  base = 1;
  async fetchOne(key: number): Promise<unknown> { await null; return key + this.base; }
}
const stranger = (0, eval)("({ base: 100, async fetchOne(key) { await null; return String.fromCharCode(115) + (key + this.base); } })");
const unseen = (0, eval)("(x) => x");
function missed(key: number): unknown { return "missed " + key; }
let strange = false;
function pick(): Keeper { return unseen(strange ? stranger : new Keeper()); }
async function byChoice(hit: boolean, key: number) { const got = await (hit ? pick().fetchOne(key) : missed(key)); return typeof got + " " + String(got); }
async function byName(hit: boolean, key: number) { const keeper = pick(); let waited; if (hit) waited = keeper.fetchOne(key); else waited = missed(key); const got = await waited; return typeof got + " " + String(got); }
for (let i = 0; i < 300; i++) { await byChoice(i % 2 === 0, i); await byName(i % 2 === 0, i); }
console.log(await byChoice(true, 1), "|", await byName(true, 3));
strange = true;
console.log(await byChoice(true, 2), "|", await byName(true, 4));
