// Static methods are inherited from class object to class object. Object.setPrototypeOf hangs the class object Child under Between: Child.make(), `this.rank()` inside it and super.rank() in a static method find Between's from then on. Instances are not affected. One number is printed.
class Base {
  static rank(): number {
    return 1;
  }
  static make(): number {
    return this.rank() * 10;
  }
  own(): number {
    return 100;
  }
}
class Between extends Base {
  static rank(): number {
    return 2;
  }
  static make(): number {
    return super.make() + 5;
  }
  own(): number {
    return 200;
  }
}
class Child extends Base {
  static above(): number {
    return super.rank() * 1000 + super.make();
  }
}
class Grandchild extends Child {}

function makeAll(classes: (typeof Base)[]): number {
  let sum = 0;
  for (const each of classes) sum = sum * 100 + each.make() + each.rank();
  return sum;
}

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

const classes = [Base, Between, Child, Grandchild];
note(makeAll(classes));
note(Child.above());
note(Grandchild.above());
Object.setPrototypeOf(Child, Between);
note(makeAll(classes));
note(Child.above());
note(Grandchild.above());
note(new Child().own());
Between.rank = () => 7;
note(makeAll(classes));
Reflect.deleteProperty(Between, "rank");
note(makeAll(classes));
Object.setPrototypeOf(Child, Base);
note(makeAll(classes));
console.log(checksum);

export {};
