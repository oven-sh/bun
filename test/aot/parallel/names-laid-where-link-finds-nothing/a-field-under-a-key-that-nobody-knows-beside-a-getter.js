// Under: --aot-check=Validate: a field under a key that nobody knows, beside a getter: the judge of the names that are laid stopped this right build
const unseen = (x) => [x][JSON.parse("0")];
const name = unseen("extra");
class Gauge {
  [name] = 7;
  constructor(level) { this.level = level; }
  get doubled() { return this.level * 2; }
}
function read(g) { let t = 0; for (let i = 0; i < 2; i++) t = (t + i) | 0; return g.doubled + g.level + g.extra; }
function main() { let sum = 0; for (let i = 0; i < 300; i++) sum += read(new Gauge(i)); console.log(sum); }
main();
