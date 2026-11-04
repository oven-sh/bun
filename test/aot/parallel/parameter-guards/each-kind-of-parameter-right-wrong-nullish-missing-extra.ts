// Each kind of declared parameter is handed the right type, a wrong one, null, undefined, nothing, and one argument too many. A type never throws and never converts.
function show(label: string, run: () => unknown) {
  try {
    const value = run();
    console.log(label, typeof value, Object.is(value, -0) ? "-0" : String(value));
  } catch (error) {
    console.log(label, "threw", (error as Error).constructor.name, (error as Error).message);
  }
}
class Point {
  x = 1;
  y = 2;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  sum() {
    return this.x + this.y;
  }
}
interface Named {
  name: string;
  size: number;
}
function ofNumber(n: number) {
  const twice = n * 2;
  const more = n + 1;
  return twice > more ? twice - more : more - twice + (n % 3);
}
function ofString(s: string) {
  const long = s.length;
  const first = s.charCodeAt(0);
  return s + ":" + long + ":" + first + ":" + s.toUpperCase();
}
function ofBoolean(b: boolean) {
  const not = !b;
  const text = b ? "yes" : "no";
  return text + (not ? "!" : "") + (b === true) + (b === false) + (b && 1);
}
function ofInstance(p: Point) {
  const across = p.x + 0;
  const down = p.y + 0;
  return across * 10 + down + p.sum();
}
function ofRecord(r: Named) {
  const called = r.name + "";
  const large = r.size + 0;
  return called + "/" + large + "/" + (large + 1);
}
function ofList(l: number[]) {
  let total = l.length;
  for (let i = 0; i < l.length; i++) total += l[i];
  return total;
}
function ofFunction(f: (n: number) => number) {
  const a = f(1);
  const b = f(2);
  return a + b;
}
function ofUnion(u: number | string) {
  if (typeof u === "number") return u + 1;
  return u + "!";
}
function ofOptional(a: number, b?: number) {
  const first = a * 2;
  return b === undefined ? first : first + b * 3;
}
function ofDefault(a: number, b: number = 7) {
  const first = a * 2;
  return first + b * 3;
}
function ofBigInt(n: bigint) {
  const twice = n * 2n;
  return twice + n;
}
function ofSymbol(s: symbol) {
  const text = s.description;
  return text + ":" + typeof s + ":" + s.toString();
}
const any = (value: unknown): any => value;
const wrong: unknown[] = [1.5, -0, NaN, "text", "", true, false, 10n, Symbol("mark"), new Point(3, 4), { name: "n", size: 2 }, { x: 5, y: 6 }, [1, 2, 3], ["a"], (n: number) => n * n, new Map(), /x/, null, undefined];
const functions: [string, (...list: any[]) => unknown][] = [["number", ofNumber], ["string", ofString], ["boolean", ofBoolean], ["instance", ofInstance], ["record", ofRecord], ["list", ofList], ["function", ofFunction], ["union", ofUnion], ["optional", ofOptional], ["default", ofDefault], ["bigint", ofBigInt], ["symbol", ofSymbol]];
show("number right", () => ofNumber(21));
show("string right", () => ofString("abc"));
show("boolean right", () => ofBoolean(true));
show("instance right", () => ofInstance(new Point(1, 2)));
show("record right", () => ofRecord({ name: "r", size: 9 }));
show("list right", () => ofList([4, 5, 6]));
show("function right", () => ofFunction(n => n + 1));
show("union right", () => ofUnion(1) + String(ofUnion("s")));
show("optional right", () => ofOptional(1, 2) + ofOptional(1));
show("default right", () => ofDefault(1, 2) + ofDefault(1));
show("bigint right", () => ofBigInt(5n));
show("symbol right", () => ofSymbol(Symbol("s")));
for (const [name, f] of functions) {
  for (let i = 0; i < wrong.length; i++) show(name + " handed " + i, () => f(any(wrong[i])));
  show(name + " missing", () => f());
  show(name + " extra", () => f(any(wrong[0]), any(wrong[3]), any(wrong[9])));
}
