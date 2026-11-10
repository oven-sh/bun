const seed = Number(process.argv[2] ?? 12);
function lay(target) {
  const descriptor = { get() { return "text" + this.v; } };
  const map = { first: descriptor };
  Object.defineProperties(target, map);
  return descriptor;
}
function read(target) { return target.first === undefined ? "nothing" : target.first.length; }
const object = { v: seed };
const kept = lay(object);
let said = "";
for (let i = 0; i < 30; i++) said = read(object);
console.log(said, typeof kept.get);
