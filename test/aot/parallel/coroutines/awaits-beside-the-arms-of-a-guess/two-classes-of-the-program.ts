class Keeper {
  base = 1;
  async fetchOne(key: number) { await null; return key + this.base; }
}
class Impostor {
  base = 10;
  fetchOne(key: number) { return Promise.resolve("impostor " + (key + this.base)); }
}
function missed(key: number) { return "missed " + key; }
async function serve(keeper: Keeper, hit: boolean, key: number) {
  const got = await (hit ? keeper.fetchOne(key) : missed(key));
  return typeof got + " " + String(got);
}
let last = "";
for (let i = 0; i < 400; i++) last = await serve(new Keeper(), i % 2 === 0, i);
console.log(last);
console.log(await serve(new Keeper(), true, 1));
console.log(await serve(new Impostor() as any, true, 2));
console.log(await serve(new Impostor() as any, false, 3));
