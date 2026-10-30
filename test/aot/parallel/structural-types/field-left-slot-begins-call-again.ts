// A typed function is given objects of the declared layout whose fields have left their slots: a getter, a value of another type, a deleted field. Every getter and every effect runs once, in order.
// STATISTIC: RestartsInGenericVersion >= 1
type Point = { x: number; y: number; label: string };

const log: string[] = [];
let calls = 0;

function describe(p: Point): string {
  let text = p.label + ":" + (p.x + p.y);
  if (p.x > p.y) text += " wide";
  if (p.label.length > 3) text += " long";
  return text;
}

function countThenRead(p: Point): string {
  const x = p.x;
  calls++;
  log.push("counted " + calls);
  return x + "/" + p.y + "/" + p.label;
}

function sumAll(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) sum += points[i].x * 2 + points[i].y;
  return sum;
}

const table: Record<string, (p: any) => unknown> = { describe, countThenRead, sumAll };
const names = (process.argv[2] ?? "describe,countThenRead").split(",");

function honest(i: number): Point {
  return { x: i, y: i * 2, label: "p" + i };
}

function withGetter(key: "x" | "y" | "label", value: unknown): Point {
  const p = honest(5);
  Object.defineProperty(p, key, {
    get() {
      log.push("get " + key);
      return value;
    },
    enumerable: true,
    configurable: true,
  });
  return p;
}

function withOtherType(key: "x" | "y" | "label", value: unknown): Point {
  const p: any = honest(6);
  p[key] = value;
  return p;
}

function without(key: "x" | "y" | "label"): Point {
  const p: any = honest(7);
  delete p[key];
  return p;
}

const given: Point[] = [honest(1), honest(2)];
for (const key of ["x", "y", "label"] as const) {
  given.push(withGetter(key, key === "label" ? "from a getter" : 40));
  given.push(withGetter(key, undefined));
  given.push(withOtherType(key, key === "label" ? 12 : "twelve"));
  given.push(withOtherType(key, { valueOf: () => (log.push("valueOf " + key), 3), toString: () => (log.push("toString " + key), "obj") }));
  given.push(without(key));
}
given.push(JSON.parse('{"x":"1","y":2,"label":"parsed"}'), JSON.parse('{"x":1,"y":2,"label":null}'), JSON.parse('{"label":"other order","y":2,"x":1}'));
given.push(Object.freeze(honest(8)), Object.create(honest(9)), new Proxy(honest(10), { get: (target, key) => (log.push("trap " + String(key)), (target as any)[key]) }));

for (let round = 0; round < 3; round++) {
  for (const name of names) {
    for (const p of given) {
      let answer: unknown;
      try {
        answer = table[name](p);
      } catch (error) {
        answer = "threw " + (error as Error).constructor.name;
      }
      console.log(round, name, String(answer), "|", log.join(", "), "|", calls);
      log.length = 0;
    }
  }
  try {
    console.log(round, "sumAll", String(table.sumAll(given)), "|", log.join(", "));
  } catch (error) {
    console.log(round, "sumAll threw", (error as Error).constructor.name, "|", log.join(", "));
  }
  log.length = 0;
}
