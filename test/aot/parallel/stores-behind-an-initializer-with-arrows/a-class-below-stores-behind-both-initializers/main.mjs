const unknown = globalThis.nobodySetsThis ?? (value => value);
class Base {
  path = "/";
  read = () => this.path;
  kept = 1;
}
class Below extends Base {
  more = 2;
  write = path => {
    this.path = path;
  };
  last = 3;
  constructor(path) {
    super();
    this.path = path;
    this.kept = 4;
    this.last = 5;
  }
}
const Made = unknown(Below);
let total = 0;
for (let i = 0; i < 300; i++) {
  const made = new Made("/" + i);
  if (i & 1) made.write("/odd");
  total += made.read().length + made.kept + made.more + made.last;
}
console.log(total, Object.keys(new Made("/")).join());
