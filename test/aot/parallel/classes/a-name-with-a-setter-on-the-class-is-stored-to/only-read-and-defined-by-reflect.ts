// Nothing assigns to the name. Reflect.defineProperty gives one object a property of its own.
class Point {
  #y = 40;
  constructor() {  }
  get y(): number { return this.#y; }
  set y(v: number) { this.#y = v; }
  
}
function read(p: Point): unknown { return p.y; }
const points = [new Point(), new Point()];
for (let i = 0; i < 3; i++) for (const p of points) console.log(read(p));
const victim: any = points[0];
Reflect.defineProperty(victim, 'y', {});
console.log(victim.y, read(points[0]), read(points[1]), Object.hasOwn(victim, "y"), Object.keys(victim).join(), JSON.stringify(Object.getOwnPropertyDescriptor(victim, "y")));
