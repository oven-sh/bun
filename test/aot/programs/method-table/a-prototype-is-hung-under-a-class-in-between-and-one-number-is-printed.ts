// Object.setPrototypeOf hangs Child.prototype under Between.prototype. From then on the methods that Child inherits, and its super calls, are Between's; then it is hung back under Base. One number is printed.
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

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

const list: Base[] = [new Base(1), new Between(2), new Child(3), new Grandchild(4)];
note(report(list));
for (const each of list) note(each.describe());
Object.setPrototypeOf(Child.prototype, Between.prototype);
note(report(list));
for (const each of list) note(each.describe());
note(new Child(5).describe());
note(Number(list[2] instanceof Between));
Object.setPrototypeOf(Child.prototype, Base.prototype);
note(report(list));
console.log(checksum);

export {};
