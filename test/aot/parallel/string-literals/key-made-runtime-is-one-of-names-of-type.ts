// A key whose type is a union of names arrives as a text that the program made while it ran: cut out of a longer text, joined, parsed, read out of a list, a map, a field.
type Point = { x: number; y: number; z: number };
type Axis = keyof Point;
type Holder = { axis: Axis; next: Axis | undefined };

function pick(point: Point, axis: Axis): number {
  return point[axis];
}
function place(point: Point, axis: Axis, value: number) {
  point[axis] = value;
}
function nameOf(axis: Axis): string {
  if (axis === "x") return "first";
  if (axis === "y") return "second";
  return "third";
}
function numberOf(axis: Axis): number {
  switch (axis) {
    case "x":
      return 1;
    case "y":
      return 2;
    case "z":
      return 3;
  }
}
function isAxis(value: unknown): value is Axis {
  return value === "x" || value === "y" || value === "z";
}

const letters = "wxyz!";
const cut: Axis[] = [];
for (let index = 1; index < 4; index++) cut.push(letters.slice(index, index + 1) as Axis);
const joined: Axis[] = ["x", "y", "z"].map(letter => ["", letter].join("") as Axis);
const parsed: Axis[] = JSON.parse('["x","y","z"]');
const fromCodes: Axis[] = [120, 121, 122].map(code => String.fromCharCode(code) as Axis);
const ropes: Axis[] = ["x", "y", "z"].map(letter => ((letter + "!").length > 1 ? "" + letter + "" : letter) as Axis);
const holders: Holder[] = JSON.parse('[{"axis":"x","next":"y"},{"axis":"y","next":"z"},{"axis":"z"}]');
const byNumber = new Map<number, Axis>();
for (let index = 0; index < 3; index++) byNumber.set(index, letters.charAt(index + 1) as Axis);
const keys = Object.keys({ x: 0, y: 0, z: 0 }) as Axis[];

const point: Point = { x: 1.5, y: 2.5, z: 3.5 };
const lines: string[] = [];
for (let turn = 0; turn < 200; turn++) {
  let sum = 0;
  let names = "";
  for (const list of [cut, joined, parsed, fromCodes, ropes, keys]) {
    for (const axis of list) {
      sum += pick(point, axis) * numberOf(axis);
      names += nameOf(axis)[0];
      place(point, axis, pick(point, axis) + 1);
    }
  }
  for (const holder of holders) {
    sum += pick(point, holder.axis);
    if (holder.next !== undefined) sum += pick(point, holder.next) * numberOf(holder.next);
    holder.next = holder.axis;
    names += nameOf(holder.axis)[1];
  }
  for (const axis of byNumber.values()) sum -= pick(point, axis);
  for (const text of ["x", "xy".slice(1), "zz".slice(0, 1), "w", "xx", ""]) names += isAxis(text) ? numberOf(text) : "-";
  if (turn % 50 === 0 || turn === 199) lines.push(`${turn} ${sum} ${names} ${point.x} ${point.y} ${point.z}`);
}
console.log(lines.join("\n"));
