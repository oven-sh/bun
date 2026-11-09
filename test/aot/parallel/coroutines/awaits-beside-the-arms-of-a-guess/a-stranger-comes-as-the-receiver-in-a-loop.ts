class Keeper {
  base = 1;
  async fetchOne(key: number) { await null; return key + this.base; }
}
const stranger = (0, eval)("({ base: 100, fetchOne(key) { return Promise.resolve('stranger ' + (key + this.base)); } })");
function missed(key: number) { return "missed " + key; }
async function drain(keeper: Keeper, count: number) {
  let text = "";
  for (let i = 0; i < count; i++) {
    const got = await (i % 2 ? keeper.fetchOne(i) : missed(i));
    text = typeof got + " " + String(got);
  }
  return text;
}
let last = "";
for (let turn = 0; turn < 150; turn++) last = await drain(new Keeper(), 4);
console.log(last);
console.log(await drain(stranger, 4));
