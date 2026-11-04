class Kit { math = Math; }
const kits: Kit[] = [new Kit(), new Kit()];
kits.push(JSON.parse('{"math":0}', (key, value) => (key === "math" ? { floor: () => -1 } : value)));
function noise(): number { return JSON.parse("0"); }
function read(i: number): number {
  const kit = kits[i];
  const floor = kit.math.floor;
  noise();
  return floor(2.5) + floor(3.5) + noise() + noise();
}
console.log(read(0), read(1), read(2));
