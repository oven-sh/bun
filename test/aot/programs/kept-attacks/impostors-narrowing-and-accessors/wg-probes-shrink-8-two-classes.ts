// Impostors narrowing and accessors: wg probes shrink  two classes. It prints what plain Bun prints.
class Shape {
  sides = 4;
}

class Square extends Shape {
  edge = 2;
}

class Holder {
  shape: Shape = new Square();
}

function edgeOf(h: Holder): unknown {
  return h.shape instanceof Square ? h.shape.edge : "no square";
}

const holder = new Holder();
Object.assign(holder, { shape: new Shape() });
console.log(edgeOf(holder));
