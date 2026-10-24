// Object.assign copies defaults onto the prototype of a class: once from a literal, once from an object parsed at run time.
// The names are those of optional fields of four kinds: a number, a string, an object and a function.
class Widget {
  declare id: number;
  declare weight?: number;
  declare title?: string;
  declare style?: { color: string };
  declare onClick?: () => string;
  constructor(id: number) {
    this.id = id;
  }
}
function look(widget: Widget) {
  return `${widget.weight} ${widget.title} ${widget.style?.color} ${widget.onClick?.()}`;
}
function fill(widget: Widget, n: number) {
  widget.weight = n;
  widget.title = "t" + n;
  widget.style = { color: "c" + n };
  widget.onClick = () => "clicked " + n;
}
function own(widget: Widget) {
  return `[${Object.keys(widget)}]`;
}
function readAssignRead(widget: Widget, holder: object, source: object) {
  const before = look(widget);
  Object.assign(holder, source);
  return before + " -> " + look(widget);
}

let length = 0;
for (let i = 0; i < 3000; i++) {
  const widget = new Widget(i);
  length += look(widget).length;
  if (i & 1) fill(widget, i & 3);
  length += look(widget).length;
}
console.log("warm", length);

const empty = new Widget(1);
const filled = new Widget(2);
fill(filled, 2);
console.log("a literal:", readAssignRead(empty, Widget.prototype, { weight: 70, onClick: () => "inherited click" }));
console.log("parsed:", readAssignRead(empty, Widget.prototype, JSON.parse('{"title":"inherited","style":{"color":"red"}}')));
const fresh = new Widget(3);
console.log("all four:", look(empty), own(empty), "|", look(filled), own(filled), "|", look(fresh), own(fresh));
const { weight = -1, title = "none", style = { color: "none" } } = fresh;
console.log("destructured:", weight, title, style.color);
fill(fresh, 9);
console.log("filled:", look(fresh), own(fresh));
delete fresh.title;
delete fresh.onClick;
console.log("two deleted:", look(fresh), own(fresh));
for (const name of ["weight", "title", "style", "onClick"]) delete (Widget.prototype as any)[name];
console.log("gone again:", look(empty), own(empty), "|", look(fresh), own(fresh), "|", look(new Widget(4)));
const { weight: w2 = -1, title: t2 = "none" } = empty;
console.log("destructured:", w2, t2);
