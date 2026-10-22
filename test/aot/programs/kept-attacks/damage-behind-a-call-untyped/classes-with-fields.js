// No types are written. A class has fields with initial values, an accessor and a method. A function uses them all, makes a call and uses them again. Below the call the object, the class or the base class is damaged.
class Base {
  kind() {
    return "base";
  }
}
class Box extends Base {
  width = 1;
  height = 2;
  open = false;
  get area() {
    return this.width * this.height;
  }
  grow() {
    return ++this.width;
  }
}
const area = Object.getOwnPropertyDescriptor(Box.prototype, "area");
const kind = Base.prototype.kind;

let mode = 0;
function below(box) {
  if (mode === 1) delete box.height;
  else if (mode === 2) box.open = "ajar";
  else if (mode === 3) Object.defineProperty(Box.prototype, "area", { get: () => -1, configurable: true });
  else if (mode === 4) Base.prototype.kind = () => "replaced";
  else if (mode === 5) Object.defineProperty(box, "area", { value: -2 });
  else if (mode === 6) Object.freeze(box);
  return 1;
}

function holder(box) {
  const before = box.width + "," + box.height + "," + box.open + "," + box.area + "," + box.kind();
  const got = below(box);
  const read = box.width + "," + box.height + "," + (box.open ? "open" : "shut") + "," + box.area + "," + box.kind();
  let grown;
  try {
    grown = box.grow();
  } catch (error) {
    grown = error.name;
  }
  return before + " " + got + " " + read + " " + grown + " " + box.width;
}

for (let round = 0; round < 700; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  const line = holder(new Box());
  Object.defineProperty(Box.prototype, "area", area);
  Base.prototype.kind = kind;
  if (mode || round === 0) console.log(round + ": " + line);
}
