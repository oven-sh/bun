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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string|symbol|function flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|object flags=[OmitsUndefined]}, {type=Array<undefined|null|number|string|[[L_1]]|Array<undefined|null|number|string|[[L_1]]|Array>> flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string|symbol|function, v1: undefined|null|object, v2: Array<undefined|null|number|string|[[L_1]]|Array<undefined|null|number|string|[[L_1]]|Array>>):
// CHECK-NEXT: v3 = Convert v0 declared={type=undefined|null|string|symbol|function flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v4 = Convert v1 declared={type=undefined|null|object flags=[OmitsUndefined]}
// CHECK-NEXT: v5 = Convert v2 declared={type=undefined|null|Array<undefined|null|number|string|[[L_1]]|Array<undefined|null|number|string|[[L_1]]|Array>> flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v6 = NewObject -, v3, v4, v5 layout=[[L_1]] fields=[2, 1, 0]
// CHECK-NEXT: v7 = FinishObject v6
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Item"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_2]]):
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = NewRuntimeError runtimeError=NotDestructurable name="label"
// CHECK-NEXT: Throw v3
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: v5 = PropGet v4 key="label"
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v7 = String string="li"
// CHECK-NEXT: v8 = NewObject -, v5 layout=[[L_4]] fields=[0]
// CHECK-NEXT: v9 = FinishObject v8
// CHECK-NEXT: v10 = Call v6, -, v7, v9, v5 calleeName="h"
// CHECK-NEXT: ReturnCall v10
// CHECK-NEXT: }
