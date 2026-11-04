const unknown = globalThis.nobodySetsThis ?? (value => value);
class Context {
  path = "/";
  status = code => {
    this.code = code;
  };
  last = 1;
  constructor(path, code) {
    this.path = path;
    this.code = code;
    this.more = code + 1;
  }
}
const Made = unknown(Context);
let total = 0;
for (let i = 0; i < 300; i++) {
  const made = new Made("/" + i, i);
  if (i & 1) made.status(201);
  total += made.path.length + made.code + made.last + made.more;
}
console.log(total, Object.keys(new Made("/", 0)).join());
