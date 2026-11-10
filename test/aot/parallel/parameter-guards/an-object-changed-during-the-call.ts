// An object of the right shape passes the guard, and a callee then changes it in every way while the function still runs: what was proven at the entry is the layout and nothing else.
function show(label: string, run: () => unknown) {
  try {
    console.log(label, String(run()));
  } catch (error) {
    console.log(label, "threw", (error as Error).constructor.name, (error as Error).message);
  }
}
class Box {
  width = 1;
  height = 2;
  label = "box";
  area() {
    return this.width * this.height;
  }
}
type Change = (box: any) => void;
let change: Change = () => {};
function touch(box: unknown) {
  change(box);
}
function measure(box: Box): string {
  const before = box.width + "," + box.height + "," + box.label + "," + box.area();
  touch(box);
  const after = box.width + "," + box.height + "," + box.label + "," + ("width" in box) + "," + Object.keys(box).join("+");
  let stored = "stored";
  try {
    box.width = 7;
    box.label = "new";
  } catch (error) {
    stored = "refused " + (error as Error).constructor.name;
  }
  const last = box.width + "," + box.label + "," + box.area();
  return before + " | " + after + " | " + stored + " | " + last;
}
const changes: [string, Change][] = [
  ["nothing", () => {}],
  ["frozen", box => Object.freeze(box)],
  ["sealed", box => Object.seal(box)],
  ["not extensible", box => Object.preventExtensions(box)],
  ["deleted", box => delete box.width],
  ["deleted and added again", box => (delete box.width, (box.width = 40))],
  ["all deleted", box => (delete box.width, delete box.height, delete box.label)],
  ["getter", box => Object.defineProperty(box, "width", { get: () => 50, configurable: true, enumerable: true })],
  ["getter and setter", box => { let held = 60; Object.defineProperty(box, "width", { get: () => held, set: value => { held = value * 2; }, configurable: true, enumerable: true }); }],
  ["read only", box => Object.defineProperty(box, "width", { value: 70, writable: false })],
  ["not enumerable", box => Object.defineProperty(box, "width", { enumerable: false })],
  ["another type", box => { box.width = "wide"; box.label = 5; }],
  ["undefined stored", box => { box.width = undefined; }],
  ["a new property", box => { box.depth = 3; }],
  ["prototype null", box => Object.setPrototypeOf(box, null)],
  ["another prototype", box => Object.setPrototypeOf(box, { area() { return -1; }, width: 80 })],
  ["deleted under another prototype", box => (Object.setPrototypeOf(box, { area() { return -1; }, width: 80 }), delete box.width)],
  ["method of its own", box => { box.area = () => 90; }],
  ["method of the class replaced", () => { Box.prototype.area = function () { return 1000 + this.width; }; }],
];
for (const [name, how] of changes) {
  change = how;
  show(name, () => measure(new Box()));
  change = () => {};
  show("untouched behind " + name, () => measure(new Box()));
}
function inLoop(box: Box, turns: number): string {
  let total = 0;
  let seen = "";
  for (let i = 0; i < turns; i++) {
    total += box.width;
    if (i === 2) touch(box);
    seen += typeof box.width + " ";
  }
  return total + " " + seen;
}
for (const [name, how] of changes) {
  change = how;
  show("loop " + name, () => inLoop(new Box(), 5));
}
