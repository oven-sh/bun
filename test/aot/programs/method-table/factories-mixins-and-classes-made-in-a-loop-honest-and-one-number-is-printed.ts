// The honest twin of the programs about class factories, mixins and classes made in a loop: classes that share the code of their methods meet at the same call sites and nothing is ever changed. One number is printed.
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

function makeShifted(by: number) {
  return class Shifted extends Root {
    label(): number {
      return this.id + by;
    }
  };
}

function labels(list: Root[]): number {
  let sum = 0;
  for (const each of list) sum = (sum * 10 + each.label()) % 1000003;
  return sum;
}

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

const list: Root[] = [new Root(1), new (Doubled(Root))(2), new (Raised(Doubled(Root)))(3), new (Doubled(Raised(Root)))(4), new (Raised(Doubled(Root)))(5)];
for (const by of [10, 20, 30]) list.push(new (makeShifted(by))(6));
for (let round = 0; round < 3; round++) {
  list.push(
    new (class extends Root {
      label(): number {
        return this.id * round;
      }
    })(7),
  );
}

for (const each of list) note(each.label());
note(labels(list));
let sum = 0;
for (let round = 0; round < 1000; round++) sum = (sum + labels(list)) % 1000003;
note(sum);
console.log(checksum);

export {};
