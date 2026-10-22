// A typed base constructor runs for its own class, a subclass, an unrelated class, a function and Object as new.target: what it allocates is what new.target selects.
class A {
  x: number = 1;
  y: string;
  constructor(y: string) {
    this.y = y;
    this.init();
  }
  init(): void {
    this.x += 1;
  }
  sum(): string {
    return this.x + this.y;
  }
}
class B extends A {
  z: number = 3;
  init(): void {
    this.x += 10;
  }
}
class Stranger {
  q: number = 5;
  init(): void {
    (this as any).x = 100;
  }
  sum(): string {
    return "stranger";
  }
}
function show(v: any): string {
  return `${v.x} ${v.y} ${v.z} ${v.q} ${typeof v.sum === "function" ? v.sum() : "none"} ${v instanceof A} ${v instanceof B} ${v instanceof Stranger} ${Object.keys(v).join()}`;
}
function make(run: () => any): any {
  try {
    return run();
  } catch (error) {
    return { x: (error as Error).name };
  }
}
const made: any[] = [
  make(() => new A("a")),
  make(() => new B("b")),
  make(() => Reflect.construct(A, ["c"], B)),
  make(() => Reflect.construct(A, ["d"], Stranger)),
  make(() => Reflect.construct(B, ["e"], A)),
  make(() => Reflect.construct(B, ["f"], Stranger)),
  make(() => Reflect.construct(A, ["g"], function () {})),
  make(() => Reflect.construct(A, ["h"], Object)),
];
for (const v of made) console.log(show(v));
function typed(a: A): string {
  return a.sum() + a.x;
}
for (const v of made) {
  try {
    console.log(typed(v));
  } catch (error) {
    console.log((error as Error).name);
  }
}
let total = 0;
for (let i = 0; i < 30000; i++) {
  const v = Reflect.construct(A, ["l"], i % 3 ? B : Stranger) as A;
  total += v.x;
  if (i % 10000 === 0) console.log(show(v));
}
console.log(total);
