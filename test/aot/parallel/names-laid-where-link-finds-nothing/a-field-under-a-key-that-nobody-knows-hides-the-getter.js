// Under: --aot-check=Validate: the same where the key spells the name of the getter at run time: the field hides it
const unseen = (x) => [x][JSON.parse("0")];
const name = unseen("doubled");
class Gauge {
  [name] = 7;
  constructor(level) { this.level = level; }
  get doubled() { return this.level * 2; }
}
function read(g) { let t = 0; for (let i = 0; i < 2; i++) t = (t + i) | 0; return g.doubled + g.level; }
function main() { let sum = 0; for (let i = 0; i < 300; i++) sum += read(new Gauge(i)); console.log(sum); }
main();
