class Keeper {
  base = 1;
  async fetchOne(key: number): Promise<unknown> { await null; return key + this.base; }
}
const stranger = (0, eval)("({ base: 100, async fetchOne(key) { await null; return String.fromCharCode(115) + (key + this.base); } })");
const unseen = (0, eval)("(x) => x");
function missed(key: number): unknown { return "missed " + key; }
const keepers: Keeper[] = [new Keeper(), new Keeper()];
async function byChoice(at: number, hit: boolean, key: number) { const got = await (hit ? keepers[at].fetchOne(key) : missed(key)); return typeof got + " " + String(got); }
for (let i = 0; i < 300; i++) await byChoice(i & 1, i % 3 !== 0, i);
console.log(await byChoice(0, true, 1));
keepers[1] = unseen(stranger);
console.log(await byChoice(1, true, 2));
