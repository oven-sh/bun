// The honest twin of the programs that give a prototype, an instance or a class object another parent: the same classes, super calls and static methods, and every object keeps the parent it was made with.
class Base {
  constructor(public n: number) {}
  static rank(): number {
    return 1;
  }
  static make(): number {
    return this.rank() * 10;
  }
  kind(): number {
    return 1;
  }
  describe(): number {
    return this.kind() * 10 + this.n;
  }
}
class Between extends Base {
  static rank(): number {
    return 2;
  }
  static make(): number {
    return super.make() + 5;
  }
  kind(): number {
    return 2;
  }
  describe(): number {
    return super.describe() + 500;
  }
}
class Child extends Base {
  static above(): number {
    return super.rank() * 1000 + super.make();
  }
  describe(): number {
    return super.describe() + super.kind() * 1000;
  }
}
class Grandchild extends Child {}

function report(list: Base[]): number {
  let sum = 0;
  for (const each of list) sum += each.describe() * 3 + each.kind();
  return sum;
}

function makeAll(classes: (typeof Base)[]): number {
  let sum = 0;
  for (const each of classes) sum = sum * 100 + each.make() + each.rank();
  return sum;
}

function note(label: string, value: number): void {
  console.log(label + ": " + value);
}

const list: Base[] = [new Base(1), new Between(2), new Child(3), new Grandchild(4)];
note("instances", report(list));
for (const each of list) note("one by one", each.describe());
note("classes", makeAll([Base, Between, Child, Grandchild]));
note("above the child", Child.above());
note("above the grandchild", Grandchild.above());
let sum = 0;
for (let round = 0; round < 1000; round++) sum += report(list);
note("a thousand rounds", sum);

export {};
