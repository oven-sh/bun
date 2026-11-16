class Kit { math = Math; bias = 1; }
const kits: Kit[] = [new Kit(), new Kit()];
kits.push(JSON.parse('{"math":0,"bias":1}', (key, value) => (key === "math" ? { floor: () => -1 } : value)));
function noise(): number { return JSON.parse("0"); }
function read(i: number): number {
  const kit = kits[i];
  const math = kit.math;
  const floor = math.floor;
  if (math) return floor(2.5);
  return noise() + noise() + noise();
}
console.log(read(0), read(1), read(2));
