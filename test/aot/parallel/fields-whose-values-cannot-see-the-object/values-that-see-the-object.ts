const seen: unknown[] = [];
function look(object: any) {
  seen.push(Object.keys(object).join() + ":" + String(object.x) + String(object.y));
  return object;
}
class Looks {
  x: number;
  m = look(this) === this;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}
class Reads {
  x: number;
  m = (this as any).x;
  n = (() => (this as any).y)();
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}
class Property {
  copy = (this as any).x;
  late = () => (this as any).x;
  constructor(public x: number, public y = 2) {}
}
class Getter {
  m = {
    owner: this,
    get x() {
      return 5;
    },
  };
  x: number;
  constructor(x: number) {
    this.x = x;
  }
}
class Called {
  x: number;
  list = [1, 2].map(it => it + ((this as any).x ?? 100));
  y: number;
  constructor(x: number) {
    this.x = x;
    this.y = x;
  }
}
class Above {
  shared() {
    return Object.keys(this).join();
  }
}
class Super extends Above {
  x: number;
  m = super.shared();
  y: number;
  constructor(x: number) {
    super();
    this.x = x;
    this.y = x;
  }
}
class Pushes {
  x: number;
  all = all.push(this as any);
  constructor(x: number) {
    this.x = all[0] === (this as any) ? x : -1;
  }
}
const all: Pushes[] = [];
for (let i = 0; i < 3; i++) {
  const looks = new Looks(i, i + 1), reads = new Reads(i, i + 1), property = new Property(i), called = new Called(i), above = new Super(i);
  console.log(looks.m, looks.x, looks.y, reads.m, reads.n, reads.x, reads.y, property.copy, property.late(), property.x, property.y);
  console.log(called.list.join(), called.x, above.m, above.x, above.y, new Getter(i).m.x, Object.keys(new Getter(i).m).join());
  console.log(JSON.stringify(new Pushes(i)));
}
console.log(seen.join(" "));
