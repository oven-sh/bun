abstract class Text {
  abstract readonly depth: number;
  abstract at(index: number): number;
}
class Short extends Text {
  readonly depth = 0;
  constructor(readonly code: number) {
    super();
  }
  at(index: number): number {
    return this.code + index;
  }
}
class Joined extends Text {
  readonly depth: number;
  constructor(readonly left: Text, readonly right: Text, readonly size: number) {
    super();
    this.depth = (left.depth > right.depth ? left.depth : right.depth) + 1;
  }
  at(index: number): number {
    return index < this.size ? this.left.at(index) : this.right.at(index - this.size);
  }
}
function join(left: Text, right: Text): Text {
  return left.depth > right.depth ? new Joined(right, left, 1) : new Joined(left, right, 1);
}
let text: Text = new Short(65);
for (let i = 1; i < 9; i++) text = i & 1 ? join(text, new Short(65 + i)) : join(text, text);
console.log(text.at(4), text.depth);

const depthOf = (text: Text): unknown => {
  try {
    return text.depth;
  } catch (error) {
    return (error as Error).constructor.name;
  }
};
const short = new Short(1);
const deep = join(short, short);
const others: any[] = [
  Object.create(Text.prototype),
  Object.create(Short.prototype),
  Object.setPrototypeOf({ depth: 3 }, Joined.prototype),
  new Proxy(deep, { get: (target, key) => (key === "depth" ? 4 : Reflect.get(target, key)) }),
  Object.freeze(new Short(2)),
  Object.defineProperty(new Short(3), "depth", { get: () => 5 }),
  Object.setPrototypeOf(new Short(4), null),
  Reflect.construct(Short, [5], Joined),
  { depth: "six" },
  Object.assign(() => 0, { depth: 7 }),
  null,
  undefined,
  8,
];
const without: any = new Joined(short, deep, 1);
delete without.depth;
others.push(without);
console.log([short, deep, ...others].map(depthOf).join(" "));
console.log(others.map(other => { try { return join(other, short).depth; } catch (error) { return (error as Error).constructor.name; } }).join(" "));
