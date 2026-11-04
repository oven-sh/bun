// An instance of a class of the program is laid above other objects, by the program and by code that the build has not seen. A store of the program then creates, replaces and deletes properties of it,
// and whoever stands below has looked the names up before.
class Settings {
  depth: number;
  declare late: number | undefined;
  declare later: string | undefined;
  constructor(depth: number) {
    this.depth = depth;
  }
}

function addLate(settings: Settings, value: number): void {
  settings.late = value;
}

function addLater(settings: Settings, value: string): void {
  settings.later = value;
}

function readBelow(below: any): string {
  return below.depth + " " + below.late + " " + below.later + " " + ("late" in below) + " " + ("later" in below);
}

function run(name: string, layBelow: (above: Settings) => unknown): void {
  const above = new Settings(1);
  const below = layBelow(above);
  let text = "";
  for (let turn = 0; turn < 60; turn++) text = readBelow(below);
  console.log(name + ": " + text);
  addLate(above, 5);
  console.log("  created: " + readBelow(below));
  addLater(above, "text");
  above.depth = 2;
  console.log("  created and replaced: " + readBelow(below));
  delete above.late;
  console.log("  deleted: " + readBelow(below));
  addLate(above, 6);
  console.log("  created again: " + readBelow(below));
}

const unseen = (text: string): any => (0, eval)(text);
for (let turn = 0; turn < 60; turn++) {
  const settings = new Settings(turn);
  addLate(settings, turn);
  addLater(settings, "t");
}
run("Object.create in the program", above => Object.create(above));
run("Object.setPrototypeOf in the program", above => Object.setPrototypeOf({}, above));
run("another instance in the program", above => Object.setPrototypeOf(new Settings(9), above));
run("Object.create in evaluated text", unseen("above => Object.create(above)"));
run("two levels in evaluated text", unseen("above => Object.create(Object.create(above))"));
run("a function's prototype in evaluated text", unseen("above => { function F() {} F.prototype = above; return new F(); }"));
run("a class below in evaluated text", unseen("above => { class C {} Object.setPrototypeOf(C.prototype, above); return new C(); }"));
