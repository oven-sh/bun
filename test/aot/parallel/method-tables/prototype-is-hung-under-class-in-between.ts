// Object.setPrototypeOf hangs Child.prototype under Between.prototype. From then on the methods that Child inherits, and its super calls, are Between's; then it is hung back under Base.
class Base {
  constructor(public n: number) {}
  kind(): number {
    return 1;
  }
  describe(): number {
    return this.kind() * 10 + this.n;
  }
}
class Between extends Base {
  kind(): number {
    return 2;
  }
  describe(): number {
    return super.describe() + 500;
  }
}
class Child extends Base {
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

function note(label: string, value: number): void {
  console.log(label + ": " + value);
}

const list: Base[] = [new Base(1), new Between(2), new Child(3), new Grandchild(4)];
note("at first", report(list));
for (const each of list) note("one by one", each.describe());
Object.setPrototypeOf(Child.prototype, Between.prototype);
note("under the class in between", report(list));
for (const each of list) note("one by one", each.describe());
note("a new child", new Child(5).describe());
note("is it one of them", Number(list[2] instanceof Between));
Object.setPrototypeOf(Child.prototype, Base.prototype);
note("back under the base", report(list));

export {};
