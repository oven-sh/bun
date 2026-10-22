type Constructor<T = {}> = new (...list: any[]) => T;
class Vec {
  x: number; y: number;
  constructor(x: number, y: number) { this.x = x; this.y = y; }
  length(): number { return Math.sqrt(this.x * this.x + this.y * this.y); }
  plus(o: Vec): this { return new (this.constructor as any)(this.x + o.x, this.y + o.y); }
}
function Labeled<T extends Constructor<Vec>>(Base: T) {
  return class extends Base { label: string = "v"; toString(): string { return this.label + "(" + this.x + "," + this.y + ")"; } };
}
const LV = Labeled(Vec);
const a = new LV(3, 4), b = new Vec(1, 2);
const c = a.plus(b), d = b.plus(a);
console.log(a.length(), String(c), c instanceof LV, c.length(), String(d.x), d instanceof LV, Object.keys(c).join());
