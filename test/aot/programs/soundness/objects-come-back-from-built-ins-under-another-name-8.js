// An object goes into a built-in and comes out under another name: a store through that name is seen by reads through the first. Each case has a class, an allocation and a store of its own.
const id = x => x;
class Cell175 { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
{
  const c = new Cell175(21);
  const before = c.twice() + c.total();
  const done = o => { if (o === null || typeof o !== "object") return console.log('deepEquals', "gave", typeof o); o.n = "x"; o.list.push("y"); console.log('deepEquals', before, String(c.twice()), typeof c.n, c.total()); };
  try { const out = (c => (Bun.deepEquals(c, c), c))(c); if (out instanceof Promise) out.then(done, e => console.log('deepEquals', "rejected", String(e))); else done(out); } catch (e) { console.log('deepEquals', "threw", e.name); }
}
