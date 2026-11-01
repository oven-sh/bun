// Classes below built-in classes that declare a private name. A field is stored in the constructor after super(), in a method and from outside, in a loop.
function check(name: string, sum: number, last: object, made: Function): void {
  console.log(
    name,
    sum,
    last instanceof made,
    Object.getPrototypeOf(last) === made.prototype,
    Object.keys(last).join(),
  );
}
class List extends Array<number> {
  #p = 1;
  r: number;
  constructor(n: number) {
    super();
    this.r = this.#p + this.m() + n;
  }
  m(): number {
    return 10;
  }
  set(n: number): void {
    this.r = this.#p + n;
  }
}
class Table extends Map<string, number> {
  #p = 1;
  r: number;
  constructor(n: number) {
    super();
    this.r = this.#p + this.m() + n;
  }
  m(): number {
    return 10;
  }
}
class Group extends Set<number> {
  #p(): number {
    return 1;
  }
  r: number;
  constructor(n: number) {
    super();
    this.r = this.#p() + n;
  }
}
class Failure extends Error {
  #p = 1;
  r: number;
  constructor(n: number) {
    super("failure");
    this.r = this.#p + n;
  }
}
class Weak extends WeakMap<object, number> {
  #p = 1;
  r = 5;
  constructor(n: number) {
    super();
    this.r += this.#p + n;
  }
}
const classes = { List, Table, Group, Failure, Weak };
for (const [name, made] of Object.entries(classes)) {
  let sum = 0;
  let last: InstanceType<typeof made> = new made(0);
  for (let i = 0; i < 20000; i++) {
    last = new made(i & 1);
    if (last instanceof made) sum += last.r;
  }
  check(name, sum, last, made);
}
let sum = 0;
let list = new List(0);
for (let i = 0; i < 20000; i++) {
  list = new List(i & 1);
  list.set(i & 3);
  sum += list.r;
  list.r = i & 7;
  sum += list.r;
}
check("methods and outside", sum, list, List);
