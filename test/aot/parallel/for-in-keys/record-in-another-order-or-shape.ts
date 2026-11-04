// What is written to be a record with two names got them in the other order, has a third, lacks one, stands below an object with names of its own, or is no such record at all.
type Point = { x: number; y: number };
function total(point: Point) {
  let sum = 0, names = "";
  for (const k in point) { sum += (point as any)[k]; names += k; }
  return names + sum;
}
class Pair { y = 2; x = 1; }
function deed() {
  const late: any = { x: 1 };
  late.y = 2;
  const below: any = Object.assign(Object.create({ z: 100 }), { x: 1, y: 2 });
  const hostile: unknown[] = [{ y: 2, x: 1 }, { x: 1, y: 2, z: 3 }, { x: 1 }, late, below, new Pair(), JSON.parse('{"x":1,"y":2}'), { x: 1, y: 2, 0: 5 }, null, [1, 2], new Proxy({ x: 1, y: 2 }, {})];
  let text = "";
  for (let at = 0; at < hostile.length; at++) text += total(hostile[at] as Point) + " ";
  return text;
}
console.log(deed());
for (let round = 0; round < 4; round++) console.log(total({ x: round, y: 2 }), "#", deed());
