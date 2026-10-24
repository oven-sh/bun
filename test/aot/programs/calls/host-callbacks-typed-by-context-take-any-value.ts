import { EventEmitter } from "node:events";

interface Row {
  name: string;
  n: number;
}
class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
  sum(): number {
    return this.x + this.y;
  }
}

const rows: Row[] = [
  { name: "Ada", n: 1 },
  { name: "Bo", n: 2 },
];
const kept: Row[] = [];
function label(row: Row): string {
  return row.name + ":" + row.n;
}
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

setTimeout(row => console.log("timer", row.name, row.n, label(row)), 0, rows[0]!);
setTimeout((row, point) => console.log("timer with two", row.name, point.sum()), 0, rows[1]!, new Point(1, 2));
setImmediate(row => console.log("immediate", label(row)), rows[0]!);
queueMicrotask(() => console.log("microtask", rows[0]!.name));
process.nextTick((row: Row) => console.log("tick", row.name), rows[1]!);
await wait(5);

const parsed: any = JSON.parse('{"name":"Pa","n":4,"more":true}');
const typed = new EventEmitter<{ row: [Row]; pair: [Row, Point]; list: [Row[]] }>();
typed.on("row", row => console.log("row", row?.name, row?.n, typeof row));
typed.on("row", row => {
  if (row && typeof row === "object") kept.push(row);
});
typed.on("pair", (row, point) => console.log("pair", label(row), point.x, point.sum()));
typed.on("list", list => console.log("list", list.length, list.map(row => row.name).join()));
typed.emit("row", rows[0]!);
typed.emit("row", parsed);
typed.emit("row", JSON.parse('{"name":5}'));
typed.emit("row", undefined as any);
typed.emit("row", "text" as any);
typed.emit("pair", rows[1]!, new Point(3, 4));
typed.emit("list", rows);
typed.emit("list", JSON.parse('[{"name":"Li","n":1}]'));
console.log(kept.length, kept[0] === rows[0], kept[1] === parsed, kept.map(row => String(row.name)).join());

const target = new EventTarget();
target.addEventListener("x", event => console.log("event", event.type, (event as CustomEvent<Row>).detail.name));
target.dispatchEvent(new CustomEvent<Row>("x", { detail: rows[0]! }));

const sorted = [3, 1, 2].map(n => ({ name: "n" + n, n })).sort((a, b) => a.n - b.n);
console.log(sorted.map(label).join());
console.log("Ada Bo".replace(/\w+/g, word => label(rows.find(row => row.name === word)!)));
console.log(JSON.stringify(rows, (key, value) => (key === "n" ? undefined : value)));
console.log(JSON.parse(JSON.stringify(rows), (key, value) => (key === "n" ? value * 2 : value))[1].n);
