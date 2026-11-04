// RUN: lower
// OPTIONS: builtin-modules

// The forms of the TypeScript handbook, with the function held by a constant.
type Constructor<T = {}> = new (...args: any[]) => T;
const lines: string[] = [];
class Sprite { name = ""; x = 0; y = 0; constructor(name: string) { this.name = name; } where(): string { return this.name + "@" + this.x + "," + this.y; } }
class Shape { sides: number; constructor(sides: number) { this.sides = sides; } where(): string { return "shape" + this.sides; } }
const Scale = <TBase extends Constructor>(Base: TBase) => class Scaling extends Base {
  _scale = 1; private hidden: number = 2; protected kept = "k"; readonly fixed: number = 3; static made: number = 0; declare later?: string;
  setScale(scale: number) { this._scale = scale; } get scale(): number { return this._scale * this.hidden; }
  constructor(...args: any[]) { super(...args); Scaling.made++; }
};
const Timestamped = <TBase extends Constructor<{ where(): string }>>(Base: TBase) => class extends Base {
  stamp: number = 17; #count: number = 0; optional?: number; nullable: string | null = null;
  where(): string { this.#count++; return "[" + this.stamp + "#" + this.#count + "]" + super.where(); }
  static isStamped(o: object): boolean { return #count in o; }
};
const Param = <TBase extends Constructor>(Base: TBase, unit: string) => class extends Base { unit: string = unit; list: number[] = []; add(n: number): this { this.list.push(n); return this; } total(): string { return this.list.reduce((a, b) => a + b, 0) + unit; } };
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

// GENERATED: Timestamped Scaling scale isStamped add
// CHECK-LABEL: function {{*}}name="Timestamped"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]]):
// CHECK-NEXT: v1 = ResolveHeritage v0
// CHECK-NEXT: v2 = NewClassToken layout=[[L_2]]
// CHECK-NEXT: v3 = NewClosure v2 function=[[f_3]]
// CHECK-NEXT: v4 = NewClass v3, v0, v1 layout=[[L_2]]
// CHECK-NEXT: v5 = NewClosure v4, v2 function=[[f_4]]
// CHECK-NEXT: DefineMethod v4, v5 layout=[[L_2]] key="where"
// CHECK-NEXT: v7 = NewClosure v2 function=[[f_5]]
// CHECK-NEXT: DefineMethod v4, v7 layout=[[L_2]] side=Static index=1 key="isStamped"
// CHECK-NEXT: v9 = FinishClass v4 layout=[[L_2]]
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Scaling"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] captures=[{type=env [[L_6]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: env [[L_6]], v1: function, v2: anything, v3: Array):
// CHECK-NEXT: v4 = Absent
// CHECK-NEXT: v5 = GetSuperBase v1
// CHECK-NEXT: v6 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v6, v3
// CHECK-NEXT: v8 = SuperConstructList v5, v2, v6 layout=[[L_7]]
// CHECK-NEXT: v9 = Convert v8 declared={type=[[L_7]]}
// CHECK-NEXT: v10 = TypeTest v4 testedType=absent
// CHECK-NEXT: Branch v10 -> taken b1(| 0), notTaken b9(| 0)
// CHECK-NEXT: b1(v11):
// CHECK-NEXT: v12 = CallDirect v9 function=[[f_8]]
// CHECK-NEXT: v13 = GetEnvironmentField v0 layout=[[L_6]]
// CHECK-NEXT: v14 = CheckInitialized v13 name="Scaling"
// CHECK-NEXT: v15 = PropGet v14 key="made"
// CHECK-NEXT: v16 = Increment v15
// CHECK-NEXT: PropSet v14, v16 key="made"
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: v19 = TypeTest v18 testedType=object
// CHECK-NEXT: Branch v19 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v20):
// CHECK-NEXT: Jump -> next b7(v20)
// CHECK-NEXT: b3(v21):
// CHECK-NEXT: v22 = TypeTest v21 testedType=undefined
// CHECK-NEXT: Branch v22 -> taken b4(| 0), notTaken b8(| 0)
// CHECK-NEXT: b4(v23):
// CHECK-NEXT: v24 = TypeTest v9 testedType=absent
// CHECK-NEXT: Branch v24 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v25):
// CHECK-NEXT: v26 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v26
// CHECK-NEXT: b6(v27):
// CHECK-NEXT: Jump -> next b7(v27)
// CHECK-NEXT: b7(v28):
// CHECK-NEXT: Return v28
// CHECK-NEXT: b8(v29):
// CHECK-NEXT: v30 = NewRuntimeError runtimeError=DerivedConstructorResult name="Scaling"
// CHECK-NEXT: Throw v30
// CHECK-NEXT: b9(v31):
// CHECK-NEXT: v32 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v32
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="scale"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_7]]} results=[{type=number}] {
// CHECK-NEXT: b0(v0: [[L_7]]):
// CHECK-NEXT: v1 = PropGet v0 key="_scale"
// CHECK-NEXT: v2 = PropGet v0 key="hidden"
// CHECK-NEXT: v3 = Mul v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="isStamped"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=1 captures=[{type=classtoken flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|object flags=[OmitsNull, OmitsUndefined]}] results=[{type=boolean}] {
// CHECK-NEXT: b0(v0: classtoken, v1: undefined|null|object):
// CHECK-NEXT: v2 = PrivateHas v1, v0 layout=[[L_2]] field=2
// CHECK-NEXT: v3 = Convert v2 declared={type=boolean}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="add"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=[[L_9]]} parameters=[{type=number}] results=[{type=undefined|null|[[L_9]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: [[L_9]], v1: number):
// CHECK-NEXT: v2 = PropGet v0 key="list"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = Call v3, v2, v1 calleeKey="push" calleeName="this.list.push"
// CHECK-NEXT: v5 = Convert v4 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v6 = Convert v0 declared={type=undefined|null|[[L_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
