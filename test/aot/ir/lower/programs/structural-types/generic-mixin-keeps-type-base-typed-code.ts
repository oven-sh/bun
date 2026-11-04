// RUN: lower
// OPTIONS: builtin-modules

// A generic mixin keeps the type of its base and typed code reads both.
function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

class Point {
  x = 1;
  y = 2;
  sum(): number {
    return this.x + this.y;
  }
}

function Tagged<B extends new (...args: any[]) => object>(Base: B) {
  return class extends Base {
    tag = "tagged";
    shout(): string {
      return this.tag.toUpperCase();
    }
  };
}

const TaggedPoint = Tagged(Point);
type TaggedPoint = InstanceType<typeof TaggedPoint>;

function total(p: TaggedPoint): number {
  return p.x + p.y + p.tag.length;
}

function move(p: TaggedPoint): void {
  p.x += 10;
  p.tag += "!";
}

const made = new TaggedPoint();
console.log(describe(made));
console.log("read: " + made.x + " " + made.y + " " + made.tag + " " + made.sum() + " " + made.shout() + " " + total(made));
move(made);
console.log("after stores: " + describe(made) + " " + total(made) + " " + made.sum());
let warm = 0;
for (let i = 0; i < 2000; i++) warm += total(new TaggedPoint());
console.log("2000 rounds: " + warm);

// GENERATED: describe Tagged total move Point shout
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: v1 = String string="keys ["
// CHECK-NEXT: v2 = Builtin builtin=Object
// CHECK-NEXT: v3 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v4 = Call v3, v2, v0 calleeName="Object.keys"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v6 = PropGet v5 key="join"
// CHECK-NEXT: v7 = String string=" "
// CHECK-NEXT: v8 = Call v6, v5, v7 calleeKey="join" calleeName="join"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v10 = Add v1, v9
// CHECK-NEXT: v11 = String string="] json "
// CHECK-NEXT: v12 = Add v10, v11
// CHECK-NEXT: v13 = Builtin builtin=JSON
// CHECK-NEXT: v14 = PropGet v13 key="stringify"
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v16 = Call v15, v13, v0 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v18 = Add v12, v17
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v19
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Tagged"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]]):
// CHECK-NEXT: v1 = ResolveHeritage v0
// CHECK-NEXT: v2 = NewClosure function=[[f_2]]
// CHECK-NEXT: v3 = NewClass v2, v0, v1 layout=[[L_3]]
// CHECK-NEXT: v4 = NewClosure function=[[f_4]]
// CHECK-NEXT: DefineMethod v3, v4 layout=[[L_3]] key="shout"
// CHECK-NEXT: v6 = FinishClass v3 layout=[[L_3]]
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="total"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_5]] flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_5]]):
// CHECK-NEXT: v1 = PropGet v0 key="x"
// CHECK-NEXT: v2 = PropGet v0 key="y"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = PropGet v0 key="tag"
// CHECK-NEXT: v5 = PropGet v4 key="length"
// CHECK-NEXT: v6 = Add v3, v5
// CHECK-NEXT: v7 = Convert v6 declared={type=number}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="move"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_5]] flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_5]]):
// CHECK-NEXT: v1 = PropGet v0 key="x"
// CHECK-NEXT: v2 = Integer integer=10
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: PropSet v0, v3 key="x"
// CHECK-NEXT: v5 = PropGet v0 key="tag"
// CHECK-NEXT: v6 = String string="!"
// CHECK-NEXT: v7 = Add v5, v6
// CHECK-NEXT: PropSet v0, v7 key="tag"
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Point"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_6]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_6]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_6]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_7]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="shout"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_3]]} results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: [[L_3]]):
// CHECK-NEXT: v1 = PropGet v0 key="tag"
// CHECK-NEXT: v2 = PropGet v1 key="toUpperCase"
// CHECK-NEXT: v3 = Call v2, v1 calleeKey="toUpperCase" calleeName="this.tag.toUpperCase"
// CHECK-NEXT: ReturnCall v3 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
