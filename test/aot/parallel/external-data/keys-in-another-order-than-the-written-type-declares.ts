// Texts list the members of a written type in every order: the object lists its keys as the text has them, for Object.keys, for in, JSON.stringify and a spread.
// Under: --aot-testing=CheckProofsAtRunTime: the fields of a layout that parsers make
type Point = { x: number; y: number; z: number; label?: string };
function load(text: string) { return JSON.parse(text) as Point; }
function keysByLoop(p: Point) { const keys: string[] = []; for (const key in p) keys.push(key); return keys.join(); }
function show(p: Point) { return [Object.keys(p).join(), keysByLoop(p), JSON.stringify(p), Object.keys({ ...p }).join(), p.x + p.y + p.z].join(" | "); }
const names = ["x", "y", "z", "label"];
function permutations(rest: string[]): string[][] {
  if (rest.length <= 1) return [rest];
  const all: string[][] = [];
  for (let i = 0; i < rest.length; i++) {
    for (const tail of permutations(rest.filter((_, j) => j !== i))) all.push([rest[i], ...tail]);
  }
  return all;
}
for (const order of [...permutations(names), ...permutations(names.slice(0, 3))]) {
  const text = "{" + order.map((name, i) => JSON.stringify(name) + ":" + (name === "label" ? '"l"' : i + 1)).join(",") + "}";
  console.log(show(load(text)));
}
