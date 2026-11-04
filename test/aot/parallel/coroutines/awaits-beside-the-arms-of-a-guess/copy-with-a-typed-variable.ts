class Keeper {
  base = 1;
  async fetchOne(key: number): Promise<unknown> { await null; return key + this.base; }
}
const stranger = (0, eval)("({ base: 100, async fetchOne(key) { await null; return String.fromCharCode(115) + (key + this.base); } })");
const unseen = (0, eval)("(x) => x");
function missed(key: number): unknown { return "missed " + key; }
let current: Keeper = new Keeper();
const ask = (key: number) => current.fetchOne(key);
function askToo(keeper: Keeper, key: number) { return keeper.fetchOne(key); }
class Front { inner: Keeper = new Keeper(); ask(key: number) { return this.inner.fetchOne(key); } }
const front = new Front();
async function serve(key: number) { const got = await ask(key); return typeof got + " " + String(got); }
async function serveToo(key: number) { const got = await askToo(current, key); return typeof got + " " + String(got); }
async function serveFront(key: number) { const got = await front.ask(key); return typeof got + " " + String(got); }
for (let i = 0; i < 300; i++) { await serve(i); await serveToo(i); await serveFront(i); }
console.log(await serve(1), "|", await serveToo(1), "|", await serveFront(1));
current = unseen(stranger); (0, eval)("(f, s) => { f.inner = s; }")(front, stranger);
console.log(await serve(2), "|", await serveToo(2), "|", await serveFront(2));
