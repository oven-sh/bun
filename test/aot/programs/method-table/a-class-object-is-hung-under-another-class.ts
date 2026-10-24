// Static methods are inherited from class object to class object. Object.setPrototypeOf hangs the class object Child under Between: Child.make(), `this.rank()` inside it and super.rank() in a static method find Between's from then on. Instances are not affected.
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

function note(label: string, value: number): void {
  console.log(label + ": " + value);
}

const classes = [Base, Between, Child, Grandchild];
note("at first", makeAll(classes));
note("above the child", Child.above());
note("above the grandchild", Grandchild.above());
Object.setPrototypeOf(Child, Between);
note("under the class in between", makeAll(classes));
note("above the child", Child.above());
note("above the grandchild", Grandchild.above());
note("an instance", new Child().own());
Between.rank = () => 7;
note("a static method is replaced", makeAll(classes));
Reflect.deleteProperty(Between, "rank");
note("and deleted", makeAll(classes));
Object.setPrototypeOf(Child, Base);
note("back under the base", makeAll(classes));

export {};
