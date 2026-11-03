// A record with numbers among its names copied into a record of another layout: the names at once, then the elements.
interface Point { a: number; b: number; c?: string }
function digest(object: any): string {
  return Reflect.ownKeys(object).map(key => String(key) + "=" + String(object[key])).join();
}
function copy(source: any): Point {
  const point: Point = source;
  return { ...point };
}
function inFront(source: any): Point & { label: number } {
  const point: Point = source;
  return { ...point, label: 1 };
}
function behind(source: any): Point & { label: number } {
  const point: Point = source;
  return { label: 1, ...point };
}
const list: any[] = [{ a: 1, b: 2, 0: "zero", 1: "one" }, { a: 3, b: 4, 7: "seven" }, { 2: 2.5, 3: 3.5, a: 5, b: 6 }];
let sum = 0;
for (let i = 0; i < 6000; i++) {
  const made: any = copy(list[i % list.length]);
  sum = (sum + made.a + Object.keys(made).length) % 1000003;
}
console.log(sum);
function show(name: string, make: () => any) {
  try {
    const source = make();
    const first: any = copy(source);
    console.log(name, digest(first), "|", digest(inFront(source)), "|", digest(behind(source)));
    first[0] = "written";
    first[9] = "new";
    first.more = 1;
    console.log(name, digest(first), "|", digest(source), "|", Object.isExtensible(first));
  } catch (error) {
    console.log(name, "threw", (error as Error).message);
  }
}
show("numbers first", () => ({ 1: "one", 0: "zero", a: 1, b: 2 }));
show("other names", () => ({ a: 1, z: "z", 0: "zero", y: "y" }));
show("holes", () => { const made: any = { a: 1, 0: "x", 1: "y", 2: "z" }; delete made[1]; return made; });
show("fractions", () => ({ a: 1, 0: 0.5, 1: 1.5 }));
show("far", () => ({ a: 1, 5000: "far", 2: "near" }));
show("very far", () => ({ a: 1, 4294967294: "last" }));
show("getter among elements", () => { let asked = 0; return { a: 1, 0: "x", get 1() { return ++asked; } }; });
show("getter among names", () => { let asked = 0; return { get a() { return ++asked; }, 0: "x" }; });
show("hidden element", () => Object.defineProperty({ a: 1, 0: "x" }, 1, { value: "hidden", enumerable: false, configurable: true, writable: true }));
show("read-only element", () => Object.defineProperty({ a: 1, 0: "x" }, 1, { value: "fixed", enumerable: true, writable: false, configurable: false }));
show("frozen", () => Object.freeze({ a: 1, 0: "x" }));
show("__proto__", () => ({ a: 1, 0: "x", ["__proto__"]: 2 }));
show("symbol", () => ({ a: 1, 0: "x", [Symbol.for("s")]: 2 }));
show("wrong kinds", () => ({ a: "text", b: null, c: 5, 0: undefined }));
show("many", () => { const made: any = { a: 1, 0: "x" }; for (let i = 0; i < 100; i++) made["n" + i] = i; return made; });
show("a list", () => Object.assign([1, 2], { a: 1 }));
show("below", () => Object.setPrototypeOf({ a: 1, 0: "x" }, { up: 1, 5: "up" }));
