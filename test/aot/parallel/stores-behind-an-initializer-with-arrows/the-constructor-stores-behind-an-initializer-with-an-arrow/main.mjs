const unknown = globalThis.nobodySetsThis ?? (value => value);
class Context {
  path = "/";
  code = 200;
  status = code => {
    this.code = code;
  };
  last = 1;
  constructor(path) {
    this.path = path;
  }
}
const Made = unknown(Context);
let total = 0;
for (let i = 0; i < 300; i++) {
  const made = new Made("/" + i);
  if (i & 1) made.status(201);
  total += made.path.length + made.code + made.last;
}
console.log(total, Object.keys(new Made("/")).join());
