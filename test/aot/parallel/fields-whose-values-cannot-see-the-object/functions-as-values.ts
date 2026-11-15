class Base {
  greet() {
    return "base greets";
  }
  static create() {
    return "created";
  }
}
class Handlers extends Object {
  name: string;
  constructor(name: string) {
    super();
    this.name = name;
  }
  arrow = () => this.name;
}
class Arrows {
  arrow = () => this.name + this.count;
  nested = () => () => [this.name, () => this.count] as const;
  plain = function (this: any) {
    return this === undefined ? "none" : typeof this;
  };
  async later() {
    return this.deferred();
  }
  deferred = async (extra = this.name) => extra + this.name;
  *each() {
    yield* this.walk();
  }
  walk = function* () {
    yield 1;
    yield 2;
  };
  target = () => typeof this;
  inherited = () => this.later.name;
  named = class {};
  sum = (a: number, b = a, ...rest: number[]) => a + b + rest.length + this.count;
  #hidden = () => this.count * 2;
  hidden() {
    return this.#hidden.name + this.#hidden();
  }
  table = { get: () => this.name, set: (name: string) => (this.name = name) };
  list = [() => this.count];
  count = 1;
  name: string;
  constructor(name: string, count: number) {
    this.name = name;
    this.count = count;
  }
}
const made: Arrows[] = [];
for (let i = 0; i < 4; i++) made.push(new Arrows("n" + i, i));
for (const it of made) {
  const { arrow, nested, plain, target, inherited, sum } = it;
  console.log(arrow(), nested()()[0], nested()()[1](), plain(), plain.call(5 as any), target(), inherited(), sum(1), sum(1, 2, 3, 4), it.hidden());
  console.log(arrow.name, nested.name, plain.name, it.named.name, it.walk.name, it.deferred.name, [...it.each()].join(), it.sum.length);
  it.table.set("renamed");
  console.log(it.table.get(), arrow(), it.list[0]());
}
console.log(made[0].arrow === made[1].arrow, Object.keys(made[0]).join());
console.log(await made[1].later(), await made[2].deferred("x"));
console.log(new Handlers("h").arrow());
class Heir extends Arrows {
  more = () => this.arrow() + this.extra;
  extra: string;
  constructor(extra: string) {
    super("heir", 9);
    this.extra = extra;
  }
}
for (let i = 0; i < 3; i++) console.log(new Heir("e" + i).more());
class Outer extends Base {
  call = () => super.greet();
  x: number;
  constructor(x: number) {
    super();
    this.x = x;
  }
}
console.log(new Outer(1).call(), new Outer(2).x);
