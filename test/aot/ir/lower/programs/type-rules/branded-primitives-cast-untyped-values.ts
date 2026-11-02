// RUN: lower
// OPTIONS: builtin-modules

// Branded primitives cast from untyped values.
type Name = string & { readonly __brand: "Name" };
type UserId = number & { readonly __brand: "UserId" };
type Flag = boolean & { readonly __brand: "Flag" };
type Big = bigint & { readonly __brand: "Big" };
type Loose = string & {};
type Slug = `${string}-${string}` & { readonly __brand: "Slug" };

function greet(name: Name): string {
  return "hi " + name;
}
function show(id: UserId): string {
  return "#" + (id + 1);
}
function flip(flag: Flag): boolean {
  return !flag;
}
function double(big: Big): bigint {
  return big * 2n;
}
function loose(text: Loose): number {
  return text.length;
}
function slug(text: Slug): string {
  return text.toUpperCase();
}
function either(value: Name | UserId): string {
  return typeof value === "string" ? "name " + value : "id " + value;
}
function maybe(name: Name | undefined): string {
  return name === undefined ? "nobody" : greet(name);
}

const body: any = JSON.parse('{"name":"ada","id":7,"flag":true,"slug":"a-b"}');
console.log(greet(body.name as Name));
console.log(show(body.id as UserId));
console.log(flip(body.flag as Flag));
console.log(loose(body.name as Loose));
console.log(slug(body.slug as Slug));
console.log(either(body.name as Name | UserId), either(body.id as Name | UserId));
console.log(maybe(body.name as Name | undefined), maybe(body.missing as Name | undefined));

const raw: unknown = "bob";
console.log(greet(raw as Name));
const count: unknown = 41;
console.log(show(count as UserId));
const large: unknown = 21n;
console.log(String(double(large as Big)));

const held = body.name as Name;
console.log(typeof held, held.length, greet(held));
const names: Name[] = [body.name as Name, raw as Name];
console.log(names.map(greet).join(", "));
const record: { name: Name; id: UserId } = { name: body.name as Name, id: body.id as UserId };
console.log(greet(record.name), show(record.id));

function brand(value: unknown): Name {
  return value as Name;
}
console.log(greet(brand("eve")));

const typed = JSON.parse('{"name":"kay"}') as { name: string };
console.log(greet(typed.name as Name));

// GENERATED: greet show flip double loose slug maybe brand
// CHECK-LABEL: function {{*}}name="greet"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="hi "
// CHECK-NEXT: v2 = Add v1, v0
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_4]]}] results=[{type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="#"
// CHECK-NEXT: v2 = Integer integer=1
// CHECK-NEXT: v3 = Add v0, v2
// CHECK-NEXT: v4 = Add v1, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="flip"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=boolean site=[[w_6]]}] results=[{type=boolean site=[[w_7]]}] {
// CHECK-NEXT: b0(v0: boolean):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = ToBoolean v0
// CHECK-NEXT: v2 = LogicalNot v1
// CHECK-NEXT: v3 = Convert v2 declared={type=boolean site=[[w_7]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="double"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|bigint site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|bigint site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|bigint):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = BigInt digits="2"
// CHECK-NEXT: v2 = Mul v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|bigint site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="loose"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_11]]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="length"
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_12]]} illTypedCause=Assertion
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="slug"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="toUpperCase"
// CHECK-NEXT: v2 = Call v1, v0 calleeKey="toUpperCase" calleeName="text.toUpperCase"
// CHECK-NEXT: ReturnCall v2 casts=[{declared={type=undefined|null|string site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="maybe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_16]] flags=[OmitsNull]}] results=[{type=undefined|null|string site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b5(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v3 = String string="nobody"
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: b5(v5):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_18]]
// CHECK-NEXT: v7 = Call v6, -, v5 calleeName="greet"
// CHECK-NEXT: ReturnCall v7 casts=[{declared={type=undefined|null|string site=[[w_19]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="brand"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string site=[[w_20]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string site=[[w_21]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
