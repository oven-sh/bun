// `both` is two calls and an addition: more than the one call in whose place a copy would stand. Top-level code that runs once calls it.
// IR+ = CallDirect .*\bfunction=(f\d+)\b[\s\S]*^function \1 name="both"
// IR- ^function f\d+ module=m\d+ kind=Module .*\bcallee=(f\d+) [\s\S]*^function \1 name="both"
class Box {
  log: string[] = [];
  constructor(
    public width: number,
    public height: number,
  ) {}
  get area() {
    this.log.push("area");
    if (this.width < 0) throw new RangeError("width");
    if (this.height < 0) throw new RangeError("height");
    return Math.floor(this.width * this.height * 100) / 100;
  }
  get rim() {
    this.log.push("rim");
    if (this.width < 0) throw new RangeError("width");
    if (this.height < 0) throw new RangeError("height");
    return Math.floor((this.width + this.height) * 200) / 100;
  }
  get both() {
    return this.area + this.rim;
  }
  set side(length: number) {
    this.log.push("side");
    if (length < 0) throw new RangeError("side");
    this.width = length;
    this.height = length;
  }
  square(length: number) {
    this.side = length;
    this.side = this.width + 1;
  }
}
const boxes: Box[] = [];
for (let i = 0; i < 6; i++) boxes.push(new Box(i * 1.25, i + 0.5));
console.log(boxes[1].both);
console.log(boxes[2].both);
console.log(boxes[3].both);
boxes[4].square(3);
boxes[5].square(4);
console.log(boxes[4].both, boxes[5].both);
try {
  boxes[0].square(-2);
} catch (error) {
  console.log(String(error));
}
console.log(boxes.map(box => box.log.join(" ")).join("; "));
export {};
