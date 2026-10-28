// The forms of the TypeScript handbook: declared functions with a type parameter that return a class.
type Constructor<T = {}> = new (...args: any[]) => T;
const lines: string[] = [];
class Sprite { name = ""; x = 0; y = 0; constructor(name: string) { this.name = name; } where(): string { return this.name + "@" + this.x + "," + this.y; } }
class Shape { sides: number; constructor(sides: number) { this.sides = sides; } where(): string { return "shape" + this.sides; } }
function Scale<TBase extends Constructor>(Base: TBase) { return class Scaling extends Base {
  _scale = 1; private hidden: number = 2; protected kept = "k"; readonly fixed: number = 3; static made: number = 0; declare later?: string;
  setScale(scale: number) { this._scale = scale; } get scale(): number { return this._scale * this.hidden; }
  constructor(...args: any[]) { super(...args); Scaling.made++; }
}; }
function Timestamped<TBase extends Constructor<{ where(): string }>>(Base: TBase) { return class extends Base {
  stamp: number = 17; #count: number = 0; optional?: number; nullable: string | null = null;
  where(): string { this.#count++; return "[" + this.stamp + "#" + this.#count + "]" + super.where(); }
  static isStamped(o: object): boolean { return #count in o; }
}; }
function Param<TBase extends Constructor>(Base: TBase, unit: string) { return class extends Base { unit: string = unit; list: number[] = []; add(n: number): this { this.list.push(n); return this; } total(): string { return this.list.reduce((a, b) => a + b, 0) + unit; } }; }
class EightBit extends Scale(Sprite) { bits: number = 8; }
class Big extends Scale(Shape) { big: boolean = true; }
class Both extends Timestamped(Scale(Sprite)) { }
const StampedShape = Timestamped(Shape), StampedSprite = Timestamped(Sprite);
const Meters = Param(Sprite, "m"), Feet = Param(Sprite, "ft");
const e = new EightBit("bird"), b = new Big(4), both = new Both("both"), ss = new StampedShape(3), sp = new StampedSprite("sp");
e.setScale(2); b.setScale(5); both.setScale(7);
lines.push([e.scale, b.scale, both.scale, e.where(), b.where(), both.where(), both.where(), ss.where(), sp.where()].join(" "));
lines.push([Object.keys(e).join("/"), Object.keys(b).join("/"), Object.keys(both).join("/"), Object.keys(ss).join("/")].join(" "));
lines.push([EightBit.made, Big.made, Both.made, Object.getPrototypeOf(EightBit).made, Object.getPrototypeOf(Big).made, Object.getPrototypeOf(EightBit).name].join());
lines.push([StampedShape.isStamped(ss), StampedShape.isStamped(sp), StampedSprite.isStamped(sp), StampedSprite.isStamped(both), Object.getPrototypeOf(Both).isStamped(both)].join());
lines.push([new Meters("a").add(1).add(2).total(), new Feet("b").add(3).total(), new Meters("c") instanceof Feet, new Feet("d").unit].join());
let sum = 0;
for (let i = 0; i < 3000; i++) { const s = new EightBit("n" + (i & 3)); s.setScale(i & 7); const g = new Big(i & 3); g.setScale(2); const t = new StampedShape(i & 1); sum += s.scale + g.scale + s.bits + g.sides + t.where().length + t.stamp + new Meters("x").add(i).list.length; }
lines.push(String(sum));
// What the types do not say.
const loose: any = new EightBit("loose"); loose._scale = "text"; loose.bits = { not: "a number" }; lines.push(String(loose.scale), typeof loose.bits);
const stranger: any = Object.create(EightBit.prototype); lines.push(String(stranger.scale), String(stranger.where === Sprite.prototype.where));
console.log(lines.join("\n"));
