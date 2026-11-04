class Keeper {
  constructor() { this.base = 1; }
  async fetchOne(key) { await null; return key + this.base; }
}
const stranger = (0, eval)("({ base: 100, async fetchOne(key) { await null; return 'stranger ' + (key + this.base); } })");
let current = new Keeper();
const ask = (key) => current.fetchOne(key);
async function serve(key) {
  const got = await ask(key);
  return typeof got + " " + String(got);
}
for (let i = 0; i < 300; i++) await serve(i);
console.log(await serve(1));
current = stranger;
console.log(await serve(2));
