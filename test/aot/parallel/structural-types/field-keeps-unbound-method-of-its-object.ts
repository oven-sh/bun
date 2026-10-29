// A field keeps an unbound method of its own object.
function show(title: string, run: () => unknown): void {
  let result: string;
  try {
    const value = run();
    result = typeof value + " " + (Object.is(value, -0) ? "-0" : String(value));
  } catch (error) {
    result = error instanceof TypeError ? "threw a TypeError" : error instanceof ReferenceError ? "threw a ReferenceError" : "threw something else";
  }
  console.log(title + ": " + result);
}

class Widget {
  size: number = 3;
  saved: () => number = this.measure;
  savedBound: () => number = this.measure.bind(this);
  savedArrow: () => number = () => this.measure();
  measure(): number {
    return this.size * 2;
  }
}

const a = new Widget();
const b = new Widget();
b.size = 30;

show("as a member: this is the widget", () => a.saved());
show("bound", () => a.savedBound());
show("arrow", () => a.savedArrow());
show("taken off: saved", () => {
  const f = a.saved;
  return f();
});
show("taken off: bound", () => {
  const f = a.savedBound;
  return f();
});
show("taken off: arrow", () => {
  const f = a.savedArrow;
  return f();
});
show("the same function in both", () => a.saved === b.saved);
show("it is the method", () => a.saved === Widget.prototype.measure);
show("bound ones differ", () => a.savedBound === b.savedBound);

b.saved = a.saved;
b.savedBound = a.savedBound;
b.savedArrow = a.savedArrow;
show("moved to another widget: saved follows the new one", () => b.saved());
show("moved to another widget: bound stays", () => b.savedBound());
show("moved to another widget: arrow stays", () => b.savedArrow());
show("keys", () => Object.keys(a).join());

class Menu {
  size: string = "large";
  measure: () => number = a.saved;
  bound: () => number = a.savedBound;
}
const menu = new Menu();
show("in a field of another class: this is the menu", () => menu.measure());
show("in a field of another class: bound", () => menu.bound());

const copy = { ...a };
copy.size = 300;
show("a spread copy: saved follows the copy", () => copy.saved());
show("a spread copy: bound stays", () => copy.savedBound());
show("a spread copy: arrow stays", () => copy.savedArrow());
show("a spread copy has no measure", () => "measure" in copy);
