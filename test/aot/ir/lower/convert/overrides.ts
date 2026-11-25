// RUN(METHOD): link
// METHOD: function {{*}}name="area" {{*}}functionTypes=[{{*}}[[ofShape]]]
// METHOD: function {{*}}role=Signature {{*}}functionTypes=[{{*}}[[ofShape]]]

// RUN(FIELD): link
// FIELD: layout [[narrow]] {{*}}name="Narrow"
// FIELD: layout {{*}}name="Wide"{{*}}supertypes=[{{*}}[[narrow]]]

// RUN(SYMBOL): link
// SYMBOL: layout [[plain]] {{*}}name="Plain"
// SYMBOL: layout {{*}}name="Marked"{{*}}supertypes=[{{*}}[[plain]]]

// RUN(IMPLEMENTED): link
// IMPLEMENTED: function {{*}}name="ring" {{*}}functionTypes=[{{*}}[[ofBell]]]
// IMPLEMENTED: function [[ofBell]] {{*}}role=Signature {{*}}functionTypes=[

// RUN(BACK): link
// BACK-NOT: layout {{*}}name="Narrow"{{*}}supertypes=

// RUN(SETTER): link
// SETTER-NOT: layout {{*}}name="Loose"{{*}}supertypes=

// RUN(INHERITED): link
// INHERITED-NOT: name="chain"{{*}}functionTypes=

// What a class declares under a name of a type that it extends or implements is read through the type that the name has there. So the type of the overriding method goes
// below the type of the method it overrides, the type of the field below the type of the field, under a symbol too, and the method below the type that the interface gives it.
// Nothing is read through a setter. A method that is only inherited is one function, whatever `this` is in its type, and nothing is declared for its sake.
class Narrow {
  side = 1;
}

class Wide {
  side = 2;
  corners = 4;
}

class Shape {
  held: Narrow = new Narrow();
  area(): number {
    return this.held.side;
  }
}

class Square extends Shape {
  held: Wide = new Wide();
  area(): number {
    return this.held.side * this.held.corners;
  }
}

class Plain {
  grain = 1;
}

class Marked {
  grain = 2;
  mark = 3;
}

const stamp = Symbol("stamp");

class Sheet {
  [stamp]: Plain = new Plain();
}

class Card extends Sheet {
  [stamp]: Marked = new Marked();
}

class Tight {
  fit = 1;
}

class Loose {
  fit = 2;
  slack = 3;
}

class Belt {
  set worn(value: Tight) {}
}

class Sash extends Belt {
  set worn(value: Loose) {}
}

class Link {
  chain(): this {
    return this;
  }
}

class Clasp extends Link {}

interface Rings {
  ring(times: number | string): number;
}

class Bell implements Rings {
  ring(times: number | string | boolean): number {
    return Number(times);
  }
}

export function measure(shape: Shape) {
  const area = shape.area;
  return area.call(shape) + shape.held.side;
}

export function read(sheet: Sheet) {
  return sheet[stamp].grain;
}

export function sound(rings: Rings) {
  return rings.ring(2);
}

export const measured = measure(new Square()) + measure(new Shape()) + sound(new Bell()) + read(new Card());
export const worn = [new Sash(), new Belt(), new Clasp().chain()];
