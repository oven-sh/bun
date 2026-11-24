// The class object of a class is linked to another class between two rounds.
class Plain {
  static kind: any = "plain";
  static count = 0;
  static make(): any {
    this.count++;
    return new this();
  }
  describe(): any {
    return "P";
  }
}
class Other {
  static kind: any = "other";
  static make(): any {
    return new this();
  }
  describe(): any {
    return "O";
  }
}
function mix(B: any): any {
  return class extends B {
    describe() {
      return "M" + super.describe();
    }
  };
}
const Current: any = class Derived extends mix(Plain) {
  describe(): any {
    return "D" + super.describe();
  }
  static label() {
    return "L" + super.kind;
  }
};
for (let round = 0; round < 5; round++) {
  if (round === 3) Object.setPrototypeOf(Current, Other);
  const made = Current.make();
  console.log(made.describe(), Current.label(), Current.kind, Current.count, made instanceof Plain, made instanceof Other);
}
