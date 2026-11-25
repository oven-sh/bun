// Cells that live by their neighbors in a tree of quadrants that is shared: canonical nodes, results kept per node, steps of powers of two, patterns read from text, beside a plain grid, in two modules
import { Universe, PlainLife, Pattern } from "./lib";
const load = (text: string, x = 0, y = 0, u = new Universe()) => {
  for (const [a, b] of Pattern.parse(text, x, y)) u.set(a, b);
  return u;
};
for (const [name, text, steps] of [["glider", Pattern.glider, 12], ["blinker", Pattern.blinker,
  5], ["rPent", Pattern.rPent, 120], ["acorn", Pattern.acorn, 90], ["gun", Pattern.gun,
  60]] as const) {
  const u = load(text);
  const plain = new PlainLife(Pattern.parse(text));
  let same = true;
  for (let i = 0; i < steps; i++) {
    u.step();
    plain.step();
    if (i % 10 === 9) same &&= plain.same(u);
  }
  console.log(name, String(u.generation), u.root.population, same && plain.same(u), u.hash,
    u.bounds?.join(), u.kept,
    u.root.population < 12 ? u.text() : Pattern.print(u.cells()).length);
}
const gun = load(Pattern.gun);
for (let i = 0; i < 4; i++) {
  gun.leap();
  console.log(String(gun.generation), gun.root.population, gun.root.level, gun.kept, gun.hits,
    gun.bounds?.join());
}
const far = load(Pattern.glider, 0, 0, load(Pattern.gun, 50, 50));
let mixed = 0;
for (let i = 0; i < 150; i++) {
  far.step();
  mixed = (mixed * 31 + far.root.population + far.hash) >>> 0;
}
console.log(mixed, far.kept, far.misses,
  Pattern.print(load(Pattern.gun).cells()) === Pattern.gun, far.get(0, 0),
  new Universe().step().text());
for (const bad of ["xyz!", "3o"]) try {
  load(bad);
} catch (e) {
  console.log((e as Error).name, (e as Error).message);
}
