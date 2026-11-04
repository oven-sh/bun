const unknown = globalThis.nobodySetsThis ?? (value => value);
class Context {
  path = "/";
  status = () => this.path;
  checked = unknown(check)(this.limit);
  last = 1;
  constructor(path) {
    this.path = path;
  }
}
let turn = 0;
function check() {
  if (++turn % 5 === 0) throw new Error("stop");
  return turn;
}
const Made = unknown(Context);
let total = 0;
let thrown = 0;
for (let i = 0; i < 300; i++) {
  try {
    const made = new Made("/" + i);
    total += made.status().length + made.checked + made.last;
  } catch {
    thrown++;
  }
}
console.log(total, thrown);
