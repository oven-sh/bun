// Four classes in a chain: one method is defined at the top and overridden in the third class only, another is overridden everywhere and calls super. They are called through parameters of all four types. Then the override in the third class is replaced and deleted, and so are links of the chain of super calls.
class One {
  constructor(public n: number) {}
  name(): number {
    return 1;
  }
  path(): number {
    return 1;
  }
}
class Two extends One {
  path(): number {
    return super.path() * 10 + 2;
  }
}
class Three extends Two {
  name(): number {
    return 3;
  }
  path(): number {
    return super.path() * 10 + 3;
  }
}
class Four extends Three {
  path(): number {
    return super.path() * 10 + 4;
  }
}

function asOne(x: One): number {
  return x.name() * 10000 + x.path();
}
function asTwo(x: Two): number {
  return x.name() * 10000 + x.path();
}
function asThree(x: Three): number {
  return x.name() * 10000 + x.path();
}
function asFour(x: Four): number {
  return x.name() * 10000 + x.path();
}

function note(label: string, value: number): void {
  console.log(label + ": " + value);
}

const one = new One(1);
const two = new Two(2);
const three = new Three(3);
const four = new Four(4);

function round(): void {
  for (const x of [one, two, three, four]) note("as the first", asOne(x));
  for (const x of [two, three, four]) note("as the second", asTwo(x));
  for (const x of [three, four]) note("as the third", asThree(x));
  note("as the fourth", asFour(four));
}

round();
Three.prototype.name = () => 5;
round();
Reflect.deleteProperty(Three.prototype, "name");
round();
Reflect.deleteProperty(Three.prototype, "path");
round();
Two.prototype.path = () => 7;
round();

export {};
