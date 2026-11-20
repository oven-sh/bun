const shared = new Proxy({ x: "proxied" }, {});
function Made(n) {
  this.x = n;
  if (n === 2) return shared;
  if (n === 3) return () => n;
  if (n === 4) return Symbol.for("primitive");
  if (n === 5) return 10n;
}
function work(n) {
  const one = new Made(n);
  return typeof one + String(one.x);
}
for (const n of [1, 2, 3, 4, 5, 6]) console.log(work(n));
