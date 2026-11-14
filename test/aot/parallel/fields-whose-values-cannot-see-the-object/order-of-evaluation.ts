const log: string[] = [];
function note<T>(name: string, value: T): T {
  log.push(name);
  return value;
}
function show(name: string, object: object) {
  console.log(name, log.join(" "), "|", Object.keys(object).join(), "|", JSON.stringify(object));
  log.length = 0;
}
class Plain {
  a: number;
  b = note("b", new Map<string, number>());
  c: string;
  d = note("d", [1, 2]);
  e = 5;
  constructor(a = note("default a", 1), c = note("default c", "c")) {
    note("statement", 0);
    this.c = note("value c", c);
    note("between", 0);
    this.a = note("value a", a);
    note("behind", 0);
  }
}
class Properties {
  first = note("first", { x: 1 });
  second: number | undefined;
  constructor(
    public third = note("default third", 3),
    private readonly fourth: string = note("default fourth", "4"),
    plain = note("default plain", third + 1),
  ) {
    note("body", plain);
  }
  get text() {
    return this.fourth;
  }
}
class Taken {
  left: number;
  right = note("right", Math.max(1, 2));
  constructor({ left, right = note("default right", 9) }: { left: number; right?: number }, ...rest: number[]) {
    this.left = left;
    if (rest.length) this.right = right;
  }
}
class Stored {
  x = note("x", 1);
  y = note("y", () => 2);
  z = () => 3;
  w: number;
  constructor(w: number) {
    this.z = note("value z", () => 4);
    this.x = note("value x", 10);
    this.w = w;
  }
}
class Late {
  a: number | undefined;
  b = note("b", new Set([1]));
  constructor(a: number) {
    for (let i = 0; i < 2; i++) note("turn" + i, i);
    if (a > 1) note("more", a);
    const self = this;
    self.a = a;
  }
}
for (let i = 0; i < 3; i++) {
  show("plain", new Plain());
  show("plain", new Plain(i, "given"));
  show("properties", new Properties());
  show("properties", new Properties(i, "text"));
  show("taken", new Taken({ left: i }));
  show("taken", new Taken({ left: i }, 1, 2));
  const stored = new Stored(i);
  show("stored", stored);
  console.log(stored.z(), stored.y(), stored.x);
  show("late", new Late(i));
}
console.log(new Properties().text, Object.getOwnPropertyNames(new Properties()).join());
