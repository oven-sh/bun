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
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]]}] results=[{type=undefined|null|[[f_3]] site=[[w_4]]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = ResolveHeritage v0
// CHECK-NEXT: v2 = NewClassToken layout=[[L_6]]
// CHECK-NEXT: v3 = NewClosure v2 function=[[f_7]]
// CHECK-NEXT: v4 = NewClass v3, v0, v1 layout=[[L_6]]
// CHECK-NEXT: v5 = NewClosure v4, v2 function=[[f_8]]
// CHECK-NEXT: DefineMethod v4, v5 layout=[[L_6]] key="where"
// CHECK-NEXT: v7 = NewClosure v2 function=[[f_9]]
// CHECK-NEXT: DefineMethod v4, v7 layout=[[L_6]] side=Static index=1 key="isStamped"
// CHECK-NEXT: v9 = FinishClass v4 layout=[[L_6]]
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[f_3]] site=[[w_4]]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Scaling"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] captures=[{type=env [[L_10]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=Array site=[[w_11]] flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: env [[L_10]], v1: function, v2: anything, v3: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = Absent
// CHECK-NEXT: v5 = GetSuperBase v1
// CHECK-NEXT: v6 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v6, v3
// CHECK-NEXT: v8 = SuperConstructList v5, v2, v6 layout=[[L_13]]
// CHECK-NEXT: v9 = Convert v8 declared={type=[[L_13]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v10 = TypeTest v4 testedType=absent
// CHECK-NEXT: Branch v10 -> taken b2(| 0), notTaken b10(| 0)
// CHECK-NEXT: b2(v11):
// CHECK-NEXT: v12 = CallDirect v9 function=[[f_14]]
// CHECK-NEXT: v13 = GetEnvironmentField v0 layout=[[L_10]]
// CHECK-NEXT: v14 = CheckInitialized v13 name="Scaling"
// CHECK-NEXT: v15 = PropGet v14 key="made"
// CHECK-NEXT: v16 = Increment v15
// CHECK-NEXT: v17 = Convert v16 declared={type=number site=[[w_15]]}
// CHECK-NEXT: PropSet v14, v17 key="made"
// CHECK-NEXT: v19 = Undefined
// CHECK-NEXT: v20 = TypeTest v19 testedType=object
// CHECK-NEXT: Branch v20 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v21):
// CHECK-NEXT: Jump -> next b8(v21)
// CHECK-NEXT: b4(v22):
// CHECK-NEXT: v23 = TypeTest v22 testedType=undefined
// CHECK-NEXT: Branch v23 -> taken b5(| 0), notTaken b9(| 0)
// CHECK-NEXT: b5(v24):
// CHECK-NEXT: v25 = TypeTest v9 testedType=absent
// CHECK-NEXT: Branch v25 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v26) frequency=Unlikely:
// CHECK-NEXT: v27 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v27
// CHECK-NEXT: b7(v28):
// CHECK-NEXT: Jump -> next b8(v28)
// CHECK-NEXT: b8(v29):
// CHECK-NEXT: Return v29
// CHECK-NEXT: b9(v30) frequency=Unlikely:
// CHECK-NEXT: v31 = NewRuntimeError runtimeError=DerivedConstructorResult name="Scaling"
// CHECK-NEXT: Throw v31
// CHECK-NEXT: b10(v32) frequency=Unlikely:
// CHECK-NEXT: v33 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v33
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="scale"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_13]] site=[[w_16]]} results=[{type=number site=[[w_17]]}] {
// CHECK-NEXT: b0(v0: [[L_13]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="_scale"
// CHECK-NEXT: v2 = PropGet v0 key="hidden"
// CHECK-NEXT: v3 = Mul v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_17]]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="isStamped"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=1 captures=[{type=classtoken flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|object site=[[w_18]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=boolean site=[[w_19]]}] {
// CHECK-NEXT: b0(v0: classtoken, v1: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PrivateHas v1, v0 layout=[[L_6]] field=2
// CHECK-NEXT: v3 = Convert v2 declared={type=boolean site=[[w_19]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="add"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=[[L_20]] site=[[w_21]]} parameters=[{type=number site=[[w_22]]}] results=[{type=undefined|null|[[L_20]] site=[[w_23]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_20]], v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PropGet v0 key="list"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = Call v3, v2, v1 calleeKey="push" calleeName="this.list.push"
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_24]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v6 = Convert v0 declared={type=undefined|null|[[L_20]] site=[[w_23]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
