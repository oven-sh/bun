class Root {
  id: number;
  name: string;
  constructor(id: number, name: string) {
    this.id = id;
    this.name = name;
  }
}
class Other {
  id: number;
  name: string;
  constructor(id: number, name: string) {
    this.id = id;
    this.name = name;
  }
}
type Ctor = new (...args: any[]) => any;
function Tagged<T extends Ctor>(Base: T) {
  return class extends Base {
    tag: string;
    constructor(...args: any[]) {
      super(...args);
      this.tag = "t" + this.id;
    }
  };
}
function Counted<T extends Ctor>(Base: T) {
  return class extends Base {
    count: number;
    constructor(...args: any[]) {
      super(...args);
      this.count = this.name.length;
    }
  };
}
const X = Counted(Tagged(Root)),
  Y = Tagged(Counted(Other));
let out = "";
for (let i = 0; i < 12; i++) {
  const x = new X(i, "n" + i),
    y = new Y(i, "m");
  out = x.tag + x.count + y.tag + y.count + Object.keys(x).join() + Object.keys(y).join();
}
console.log(out);
