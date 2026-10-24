// Guards that fail once: t forin2. It prints what plain Bun prints.
class Options {
  constructor() { this.host = "localhost"; this.port = 80; }
}
const rounds = Number(process.argv[2]);
const extra = "ex" + process.argv[3];
const port = "po" + process.argv[4];
const change = (object, f) => { f(object); return object; };
const objects = [
  change(new Options(), o => { o[extra] = 1; }),
  change(new Options(), o => { o[extra] = 1; delete o[extra]; }),
  change(new Options(), o => { o[port] = "eighty"; o[port] = 80; }),
  change({ first: 1, second: 2 }, o => { o[extra] = 3; }),
  change(new Options(), o => { o[port] = "eighty"; }),
  change(new Options(), o => { o[port] = 0.5; o[port] = 80; }),
];
function walk(object) {
  let keys = "";
  for (const key in object) keys += key + "=" + object[key] + " ";
  return keys.trim();
}
const object = objects[Number(process.argv[5])];
let n = 0;
for (let round = 0; round < rounds; round++) n += walk(object).length;
console.log(n, walk(object));
