// RUN: lower
// OPTIONS: builtin-modules

interface Key { key: number }
type F<T> = { value: T; more?: number };
interface G<T> { value: T; more?: number }
type Nine = F<F<F<F<F<F<F<F<F<Key>>>>>>>>>;
type Eight = F<F<F<F<F<F<F<F<Key>>>>>>>>;
type Ten = G<G<G<G<G<G<G<G<G<G<Key>>>>>>>>>>;

const eight: Eight = { value: { value: { value: { value: { value: { value: { value: { value: { key: 8 } } } } } } } } };
const nine: Nine = { value: { value: { value: { value: { value: { value: { value: { value: { value: { key: 9 } } } } } } } } } };
const ten: Ten = { value: { value: { value: { value: { value: { value: { value: { value: { value: { value: { key: 10 } } } } } } } } } } };
const around: Nine = { value: eight, more: 1 };

const readEight = () => eight.value.value.value.value.value.value.value.value.key;
const readNine = () => nine.value.value.value.value.value.value.value.value.value.key;
const readTen = () => ten.value.value.value.value.value.value.value.value.value.value.key;
function inner(from: Nine): Eight {
  return from.value;
}

console.log(readEight(), readNine(), readTen(), around.more, around.value === eight);
console.log(inner(nine).value.value.value.value.value.value.value.value.key, inner(around) === eight, nine.more, Object.keys(nine).join());
nine.more = 2;
nine.value = eight;
console.log(nine.more, readNine(), JSON.stringify(ten).length);

// GENERATED: inner readEight
// CHECK-LABEL: function {{*}}name="inner"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: v1 = PropGet v0 key="value"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="readEight"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="eight"
// CHECK-NEXT: v2 = PropGet v1 key="value"
// CHECK-NEXT: v3 = PropGet v2 key="value"
// CHECK-NEXT: v4 = PropGet v3 key="value"
// CHECK-NEXT: v5 = PropGet v4 key="value"
// CHECK-NEXT: v6 = PropGet v5 key="value"
// CHECK-NEXT: v7 = PropGet v6 key="value"
// CHECK-NEXT: v8 = PropGet v7 key="value"
// CHECK-NEXT: v9 = PropGet v8 key="value"
// CHECK-NEXT: v10 = PropGet v9 key="key"
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
