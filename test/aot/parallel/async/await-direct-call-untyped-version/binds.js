// Binds of plain functions that the compiler sees, with objects, a number and a function bound; some of the bound functions are constructed now and then.
const N = 20000, kept = [];
const only = process.env.WAYS_ONLY;
function readsTwo(a, b) { return a.v + b.v; }
function readsThree(a, b, c) { return a.v + b.v + c.v; }
function readsFive(a, b, c, d, e) { return a.v + b.v + c.v + d.v + (e ? e.v : 0); }
function sometimesConstructed(a, b) { if (new.target) { this.sum = a.v + b.v; return; } return a.v + b.v; }
function Holder(a, b) { this.a = a; this.b = b; }
function takesNumber(a, n) { return a.v + n; }
function takesCallback(a, f) { return f(a); }
const ways = {
  oneObject: o => readsTwo.bind(null, o),
  threeObjects: o => readsThree.bind(null, o, o, o),
  fourObjects: o => readsFive.bind(null, o, o, o, o),
  constructedNowAndThen: o => sometimesConstructed.bind(null, o),
  constructorFunction: o => Holder.bind(null, o),
  objectAndNumber: (o, i) => takesNumber.bind(null, o, i),
  objectAndFunction: o => takesCallback.bind(null, o, x => x.v),
};
let sum = 0;
for (const name in ways) {
  if (only && only !== name) continue;
  const way = ways[name];
  for (let i = 0; i < N; i++) {
    const o = { v: i };
    const f = way(o, i);
    if ((i & 1023) === 0) {
      kept.push(f);
      if (name === "constructedNowAndThen") sum += new f(o).sum + f(o);
      else if (name === "constructorFunction") { const h = new f(o); sum += h.a.v + h.b.v + (h instanceof Holder ? 1 : 0) + (h instanceof f ? 1 : 0); }
      else sum += f(o, o) | 0;
    }
  }
}
console.log(sum, kept.length);
