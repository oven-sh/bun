const unknown = globalThis.nobodySetsThis ?? (value => value);
function touch(made) {
  made.extra = 5;
  delete made.path;
  return 2;
}
class Context {
  path = "/";
  touched = unknown(touch)(this);
  last = 1;
  constructor(path) {
    this.path = path;
    this.last = 7;
  }
}
const Made = unknown(Context);
let total = 0;
for (let i = 0; i < 300; i++) {
  const made = new Made("/" + i);
  total += made.path.length + made.touched + made.last + made.extra;
}
console.log(total, Object.keys(new Made("/")).join());
