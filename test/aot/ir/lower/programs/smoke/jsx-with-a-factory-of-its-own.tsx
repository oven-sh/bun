// RUN: lower
// OPTIONS: builtin-modules

/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
type Child = string | number | Element | Child[];
interface Element {
  tag: string | Function | symbol;
  props: Record<string, unknown> | null;
  children: Child[];
}
declare global {
  namespace JSX {
    interface IntrinsicElements {
      [name: string]: Record<string, unknown>;
    }
  }
}
const Fragment = Symbol("fragment");
function h(tag: Element["tag"], props: Element["props"], ...children: Child[]): Element {
  return { tag, props, children };
}
function Item({ label }: { label: string; key?: string | number }) {
  return <li title={label}>{label}</li>;
}
const props = { id: "list", "data-x": 1 };
const tree = (
  <ul {...props} className="c">
    <Item label="one" />
    <li>
      <b>2</b> &amp; more
    </li>
    <>
      {[3, 4].map(n => (
        <Item label={String(n)} key={n} />
      ))}
    </>
  </ul>
);
console.log(tree.tag, tree.children.length, JSON.stringify(tree.props));

// GENERATED: h Item
// CHECK-LABEL: function {{*}}name="h"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string|symbol|function site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|object site=[[w_2]] flags=[OmitsUndefined]}, {type=Array<undefined|null|number|string|[[L_3]]|Array<undefined|null|number|string|[[L_3]]|Array>> site=[[w_4]] flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_3]] site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string|symbol|function, v1: undefined|null|object, v2: Array<undefined|null|number|string|[[L_3]]|Array<undefined|null|number|string|[[L_3]]|Array>>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Convert v0 declared={type=undefined|null|string|symbol|function flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = Convert v1 declared={type=undefined|null|object flags=[OmitsUndefined]}
// CHECK-NEXT: v5 = Convert v2 declared={type=undefined|null|Array<undefined|null|number|string|[[L_3]]|Array<undefined|null|number|string|[[L_3]]|Array>> flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v6 = NewObject -, v3, v4, v5 layout=[[L_3]] fields=[2, 1, 0]
// CHECK-NEXT: v7 = FinishObject v6
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[L_3]] site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Item"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_6]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_6]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v3 = NewRuntimeError runtimeError=NotDestructurable name="label"
// CHECK-NEXT: Throw v3
// CHECK-NEXT: b4(v4):
// CHECK-NEXT: v5 = PropGet v4 key="label"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v8 = String string="li"
// CHECK-NEXT: v9 = NewObject -, v6 layout=[[L_9]] fields=[0]
// CHECK-NEXT: v10 = FinishObject v9
// CHECK-NEXT: v11 = Call v7, -, v8, v10, v6 calleeName="h"
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
