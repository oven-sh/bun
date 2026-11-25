// new under other names, Reflect.construct, bound functions, proxies, new.target and calls without new.
class Found { constructor(row) { this.kind = 'found'; } }
function Made(row) {
  if (row.other) return new Found(row);
  this.kind = new.target === undefined ? 'called' : new.target.name;
}
function Guarded(row) {
  if (!(this instanceof Guarded)) return new Guarded(row);
  if (row.other) return new Found(row);
  this.kind = 'guarded';
}
class Other {}
const Bound = Made.bind(null), Watched = new Proxy(Made, {}), held = { Made }, list = [Made, Guarded];
const rows = JSON.parse('[{"other":false,"n":1},{"other":true,"n":2},{"other":false,"n":3},{"other":true,"n":4}]');
for (const row of rows) {
  const at = row.n % 2;
  console.log(new Made(row).kind, new Bound(row).kind, new Watched(row).kind, new held.Made(row).kind, new list[at](row).kind);
  console.log(Reflect.construct(Made, [row]).kind, Reflect.construct(Made, [row], Other).kind, Reflect.construct(Made, [row], Other) instanceof Other, new Guarded(row).kind, Guarded(row).kind);
}
