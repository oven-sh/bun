// An instance that does flow into a record type can have its method replaced through that type, and calls must see the replacement.
interface Named {
  label?: () => string;
  size?: number;
}

class Box {
  size = 1;
  label(): string {
    return "box " + this.size;
  }
}

class Crate extends Box {
  weight = 2;
}

function rename(target: Named, text: string): void {
  target.label = () => text;
}

function describe(box: Box): string {
  return box.label();
}

const plain = new Box();
const renamed = new Box();
const crate = new Crate();
rename(renamed, "renamed");
rename(crate, "crate");
rename({}, "nobody");
console.log(describe(plain), describe(renamed), describe(crate), describe(new Crate()));
