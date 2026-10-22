// Object.setPrototypeOf moves single instances: under a sibling class, under a class that is no relative and has methods of the same names, under a literal, and under an empty link in front of their own class. The other instances stay. One number is printed.
class Base {
  constructor(public n: number) {}
  kind(): number {
    return 1;
  }
  describe(): number {
    return this.kind() * 10 + this.n;
  }
}
class Left extends Base {
  kind(): number {
    return 2;
  }
}
class Right extends Base {
  kind(): number {
    return 3;
  }
  describe(): number {
    return super.describe() + 500;
  }
}
class Stranger {
  n = -1;
  kind(): number {
    return 4;
  }
  describe(): number {
    return this.kind() * 100 + this.n;
  }
}

function describeAll(list: Base[]): number {
  let sum = 0;
  for (const each of list) sum = sum * 2 + each.describe();
  return sum;
}

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

const list: Base[] = [new Base(1), new Left(2), new Right(3), new Left(4), new Right(5), new Base(6)];
note(describeAll(list));
Object.setPrototypeOf(list[1], Right.prototype);
note(describeAll(list));
Object.setPrototypeOf(list[2], Stranger.prototype);
note(describeAll(list));
Object.setPrototypeOf(list[0], {
  kind() {
    return 5;
  },
  describe() {
    return 7000;
  },
});
note(describeAll(list));
Object.setPrototypeOf(list[3], Object.create(Left.prototype));
note(describeAll(list));
Object.getPrototypeOf(list[3]).kind = () => 6;
note(describeAll(list));
Object.setPrototypeOf(list[1], Left.prototype);
Object.setPrototypeOf(list[2], Right.prototype);
Object.setPrototypeOf(list[0], Base.prototype);
Object.setPrototypeOf(list[3], Left.prototype);
note(describeAll(list));
console.log(checksum);

export {};
