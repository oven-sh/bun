// Nothing assigns to the name but a store through super, which begins at a parent that lacks it.
class Base {
}

class Point extends Base {
  #y = 40;
  constructor() {
    super();
  }
  get y() {
    return this.#y;
  }
  set y(v) {
    this.#y = v;
  }
  hide() {
    super.y = 5;
  }
}
function read(p) {
  return p.y;
}
const points = [new Point, new Point];
for (let i = 0;i < 3; i++)
  for (const p of points)
    console.log(read(p));
const victim = points[0];
victim.hide();
console.log(victim.y, read(points[0]), read(points[1]), Object.hasOwn(victim, "y"), Object.keys(victim).join(), JSON.stringify(Object.getOwnPropertyDescriptor(victim, "y")));
