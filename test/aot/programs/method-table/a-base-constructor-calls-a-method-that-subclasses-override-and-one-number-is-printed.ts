// The constructor of the base class calls this.measure() while the object is still being made: the fields of the subclass do not exist yet, and the override runs all the same. Then an override is replaced and another is deleted, and objects made afterwards are measured by what is there at that time. One number is printed.
class Widget {
  size: number;
  constructor(public scale: number) {
    this.size = this.measure() * scale;
  }
  measure(): number {
    return 1;
  }
}
class Panel extends Widget {
  pad = 5;
  measure(): number {
    return (this.pad ?? 100) + 2;
  }
}
class Button extends Panel {
  border = 1;
  measure(): number {
    return super.measure() + (this.border ?? 1000);
  }
}
class Label extends Widget {}

function makeAll(): Widget[] {
  return [new Widget(1), new Panel(2), new Button(3), new Label(4)];
}

function sizes(widgets: Widget[]): number {
  let sum = 0;
  for (const widget of widgets) sum += widget.size * 10000 + widget.measure();
  return sum;
}

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

const first = makeAll();
for (const widget of first) note(widget.size);
note(sizes(first));
Panel.prototype.measure = () => 7;
const second = makeAll();
for (const widget of second) note(widget.size);
note(sizes(second));
Reflect.deleteProperty(Button.prototype, "measure");
const third = makeAll();
for (const widget of third) note(widget.size);
note(sizes(third));
note(sizes(first));
console.log(checksum);

export {};
