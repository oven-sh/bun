// Known numbers of objects, arrays, maps and closures are alive when the program exits, and 100,000 more objects are garbage by then. object-census.test.ts runs it with BUN_JSC_dumpAOTObjectCensusAtExit=1 and looks for those numbers in the census. The output is that of plain Bun.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

class Holder {
  items: Point[];
  lookup?: Map<string, Point>;
  constructor(items: Point[]) {
    this.items = items;
  }
}

class Button {
  label: string;
  press = () => "pressed";
  constructor(label: string) {
    this.label = label;
  }
}

function createTicket(number: number): () => number {
  return function ticket() {
    return number * 2 + 1;
  };
}

let scratch: Point[] = [];
function sumDroppedPoints(count: number): number {
  for (let i = 0; i < count; i++) scratch.push(new Point(i, 1));
  let sum = 0;
  for (const point of scratch) sum += point.x + point.y;
  scratch = [];
  return sum;
}
const droppedSum = sumDroppedPoints(100_000);

const points: Point[] = [];
for (let i = 0; i < 1000; i++) points.push(new Point(i, -2 * i));

const holders: Holder[] = [];
for (let i = 0; i < 10; i++) {
  const holder = new Holder(i < 4 ? [] : points.slice(0, i));
  if (i % 2 === 0) {
    const lookup = new Map<string, Point>();
    if (i % 4 === 0) lookup.set("first", points[i]);
    holder.lookup = lookup;
  }
  holders.push(holder);
}

const tickets: (() => number)[] = [];
for (let i = 0; i < 500; i++) tickets.push(createTicket(i));

const buttons: Button[] = [];
for (let i = 0; i < 100; i++) buttons.push(new Button("button " + i));
const handlers: (() => string)[] = [];
for (let i = 0; i < 30; i++) handlers.push(buttons[i].press);

function describeLiveObjects(): string {
  let coordinates = 0;
  for (const point of points) coordinates += point.x + point.y;
  let items = 0;
  let entries = 0;
  for (const holder of holders) {
    items += holder.items.length;
    if (holder.lookup) entries += holder.lookup.size;
  }
  let numbers = 0;
  for (const ticket of tickets) numbers += ticket();
  let characters = 0;
  for (const button of buttons) characters += button.label.length + button.press().length;
  for (const handler of handlers) characters += handler().length;
  return [scratch.length, coordinates, items, entries, numbers, characters].join(" ");
}
// Reachable from the global object, the function keeps every variable it reads alive until the exit, and none of the objects reaches untyped code.
(globalThis as any).describeLiveObjects = describeLiveObjects;
console.log(droppedSum, describeLiveObjects());
export {};
