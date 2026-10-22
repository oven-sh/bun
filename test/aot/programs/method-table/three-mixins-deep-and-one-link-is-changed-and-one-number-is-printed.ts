// Three mixins, each with an override that calls super, are applied in two orders, and in one order twice. The method of the link in the middle of one of the three results is replaced: only the objects of that result change. One number is printed.
type Constructor<T> = new (...parameters: any[]) => T;

class Root {
  constructor(public id: number) {}
  label(): number {
    return this.id;
  }
}

function Doubled<B extends Constructor<Root>>(Parent: B) {
  return class extends Parent {
    label(): number {
      return super.label() * 2;
    }
  };
}
function Raised<B extends Constructor<Root>>(Parent: B) {
  return class extends Parent {
    label(): number {
      return super.label() + 1;
    }
  };
}
function Squared<B extends Constructor<Root>>(Parent: B) {
  return class extends Parent {
    label(): number {
      const below = super.label();
      return below * below;
    }
  };
}

function labels(list: Root[]): number {
  let sum = 0;
  for (const each of list) sum = sum * 100 + each.label();
  return sum;
}

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

const First = Squared(Raised(Doubled(Root)));
const Second = Doubled(Raised(Squared(Root)));
const Third = Squared(Raised(Doubled(Root)));
const list: Root[] = [new Root(2), new First(2), new Second(2), new Third(2)];

note(labels(list));
Object.getPrototypeOf(First.prototype).label = () => 3;
note(labels(list));
note(labels([new Root(1), new First(1), new Second(1), new Third(1)]));
Reflect.deleteProperty(Object.getPrototypeOf(Third.prototype), "label");
note(labels(list));
Root.prototype.label = () => 4;
note(labels(list));
console.log(checksum);

export {};
