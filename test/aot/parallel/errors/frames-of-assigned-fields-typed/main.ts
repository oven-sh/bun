// Prints the frame of the constructor where the value of a field throws under "useDefineForClassFields": false, in code that is type-checked: it stands in the value of the field.
function fail(n: number): never {
  throw new Error("failed " + n);
}
class Base {}
class Unwritten extends Base {
  before = 0;
  y = fail(1);
}
class Written extends Base {
  before = 0;
  y = fail(2);
  constructor() {
    super();
  }
}
class Alone {
  before = 0;
  y = fail(3);
}
class WithProperty {
  y = fail(4);
  constructor(public x: number) {}
}
for (const make of [() => new Unwritten(), () => new Written(), () => new Alone(), () => new WithProperty(1)]) {
  try {
    make();
  } catch (error) {
    const lines = String((error as Error).stack).split("\n").slice(1, 3);
    console.log(lines.map(line => line.trim().replace(/\(.*[\\/]/, "(")).join(" < "));
  }
}
