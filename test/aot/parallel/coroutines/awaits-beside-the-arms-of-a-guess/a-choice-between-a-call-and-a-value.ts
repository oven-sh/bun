class Keeper {
  base = 1;
  async fetchOne(key: number): Promise<unknown> { await null; return key + this.base; }
}
const stranger = (0, eval)("({ base: 100, async fetchOne(key) { await null; return 'stranger ' + (key + this.base); } })");
function missed(key: number): unknown { return "missed " + key; }
async function byChoice(keeper: Keeper, hit: boolean, key: number) {
  const got = await (hit ? keeper.fetchOne(key) : missed(key));
  return typeof got + " " + String(got);
}
async function byChain(keeper: Keeper | undefined, key: number) {
  const got = await keeper?.fetchOne(key);
  return typeof got + " " + String(got);
}
function choose(keeper: unknown, hit: boolean, key: number) { return byChoice(keeper as Keeper, hit, key); }
function chain(keeper: unknown, key: number) { return byChain(keeper as Keeper | undefined, key); }
for (let i = 0; i < 300; i++) {
  await choose(new Keeper(), i % 2 === 0, i);
  await chain(i % 7 ? new Keeper() : undefined, i);
}
console.log(await choose(new Keeper(), true, 1));
console.log(await choose(stranger, true, 2));
console.log(await chain(new Keeper(), 3));
console.log(await chain(stranger, 4));
