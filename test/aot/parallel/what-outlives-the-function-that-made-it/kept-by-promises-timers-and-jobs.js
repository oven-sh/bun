const out = [];
function start(i) {
  const a = { v: i }, b = { v: i + 1 }, c = { v: i + 2 }, d = { v: i + 3 };
  Promise.resolve(a).then(x => out.push(x.v));
  setTimeout(x => out.push(x.v), 0, b);
  queueMicrotask(() => out.push(c.v));
  return new Promise(resolve => resolve(d));
}
const d = await start(1);
await new Promise(resolve => setTimeout(resolve, 5));
console.log(out.sort().join(), d.v);
