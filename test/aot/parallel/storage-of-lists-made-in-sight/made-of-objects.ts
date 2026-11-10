// STATISTIC: ReadsOfElementsKnownToBeThere >= 1
const lines: string[] = [];

function text(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (value === undefined) return "undefined";
  return JSON.stringify(value);
}

function describe(list: any[]): string {
  let out = "[" + list.length + ":";
  for (let k = 0; k < list.length && k < 10; k++) out += (k in list ? text(list[k]) : "hole") + ",";
  return out + "]";
}

function show(label: string, i: number, value: unknown): void {
  lines.push(label + " " + i + " " + (Array.isArray(value) ? describe(value) : text(value)));
}

class Square { constructor(public side: number) {} area() { return this.side * this.side; } }
class Disk { constructor(public radius: number) {} area() { return 3 * this.radius * this.radius; } }
function madeOfObjects(n: number) { const shapes = [new Square(2), new Disk(1), new Square(3)]; let sum = 0; for (let k = 0; k < n; k++) sum += shapes[k % 3].area(); return sum; }

async function main(): Promise<void> {
  for (let i = 0; i < 6; i++) show("madeOfObjects", i, madeOfObjects(i * 5));
  console.log(lines.join("\n"));
}

main();
