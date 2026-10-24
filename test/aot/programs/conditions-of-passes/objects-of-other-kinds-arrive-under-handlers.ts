// Functions written for one class look at their argument under handlers of every shape, and are given objects of other kinds.
class Box {
  value: number;
  more: number;
  constructor(value: number, more: number) {
    this.value = value;
    this.more = more;
  }
}
const said: unknown[] = [];
function caught(box: Box, by: number): number {
  try {
    return box.value * by + box.more;
  } catch (error) {
    said.push("caught", (error as Error).name);
    return -1;
  }
}
function cleaned(box: Box, by: number): number {
  try {
    return box.value * by + box.more;
  } finally {
    said.push("finally", by);
  }
}
function both(box: Box, by: number): number {
  let sum = 0;
  try {
    sum = box.value * by;
    sum += box.more;
  } catch (error) {
    said.push("caught", (error as Error).name);
    sum = -1;
  } finally {
    said.push("finally", sum);
  }
  return sum;
}
function nested(box: Box, by: number): number {
  try {
    try {
      return box.value * by + box.more;
    } finally {
      said.push("inner");
    }
  } catch (error) {
    said.push("outer", (error as Error).name);
    return -2;
  }
}
const strangers: Box[] = [
  new Box(1, 2),
  { value: 3, more: 4 } as Box,
  Object.defineProperty(new Box(0, 1), "value", {
    get() {
      said.push("get");
      return 5;
    },
  }),
  Object.defineProperty(new Box(0, 1), "value", {
    get() {
      said.push("get and throw");
      throw new Error("no value");
    },
  }),
  Object.defineProperty(new Box(7, 1), "more", {
    get() {
      throw new Error("no more");
    },
  }),
  null as unknown as Box,
  new Proxy(new Box(8, 9), {
    get(target, key) {
      said.push("asked", String(key));
      return Reflect.get(target, key);
    },
  }),
];
for (let round = 0; round < 3; round++)
  for (const box of strangers)
    for (const work of [caught, cleaned, both, nested]) {
      try {
        said.push(work(box, round + 1));
      } catch (error) {
        said.push("left", (error as Error).name);
      }
    }
console.log(said.join());
