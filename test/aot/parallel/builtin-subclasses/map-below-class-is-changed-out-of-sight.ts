// An instance of a class below Map gains own properties, loses them and changes its prototype in code the compiler cannot see; each call behind that finds what the language says.
class Defaults extends Map<string, number> {
  getOr(key: string, fallback: number): number {
    return this.get(key) ?? fallback;
  }
}
const change = new Function("o", "how", `
  if (how === 1) o.getOr = () => 42;
  if (how === 2) { delete o.getOr; o.get = () => 7; }
  if (how === 3) { delete o.get; Object.setPrototypeOf(o, { __proto__: Map.prototype, getOr() { return 5; } }); }
  if (how === 4) Object.setPrototypeOf(o, Map.prototype);
`) as (o: object, how: number) => void;
function local(): void {
  const d = new Defaults([["a", 1]]);
  console.log("local", d.getOr("a", 9), d.getOr("b", 9));
  for (let how = 1; how <= 3; how++) {
    change(d, how);
    console.log("local", how, d.getOr("a", 9), d.getOr("b", 9), d instanceof Defaults);
  }
  change(d, 4);
  console.log("local", typeof d.getOr, d instanceof Defaults, d instanceof Map);
}
const shared = new Defaults([["a", 1]]);
function read(d: Defaults): number {
  return d.getOr("a", 9) + d.getOr("b", 9);
}
function viaParameter(): void {
  let sum = 0;
  for (let i = 0; i < 1000; i++) sum += read(shared);
  console.log("parameter", sum);
  for (let how = 1; how <= 3; how++) {
    change(shared, how);
    console.log("parameter", how, read(shared), read(new Defaults([["b", 3]])));
  }
}
local();
viaParameter();
const made = Reflect.construct(Map, [[["a", 4]]], Defaults) as Defaults;
console.log("constructed", read(made), made instanceof Defaults);
