// RUN: lower
// OPTIONS: builtin-modules

// An anonymous function or class takes the name of the identifier it is assigned to. Bun's transpiler erases parentheses and type syntax around that identifier first.
function namesOf(...values: any[]): string {
  return JSON.stringify(values.map(value => value.name));
}

let plain: any, parenthesized: any, cast: any, asserted: any, nested: any;
plain = function () {};
(parenthesized) = function () {};
(cast as any) = () => {};
asserted! = class {};
((nested as any)!) = function () {};
console.log(namesOf(plain, parenthesized, cast, asserted, nested));

let or: any, and: any = 1, nullish: any;
(or) ||= function () {};
(and as any) &&= () => {};
nullish! ??= class {};
console.log(namesOf(or, and, nullish));

let element: any, parenthesizedElement: any, castElement: any, assertedElement: any;
[
  element = function () {},
  (parenthesizedElement) = function () {},
  (castElement as any) = () => {},
  assertedElement! = class {},
] = [] as any[];
console.log(namesOf(element, parenthesizedElement, castElement, assertedElement));

let property: any, castProperty: any, shorthand: any;
({ a: (property) = function () {}, b: (castProperty as any) = () => {}, shorthand = class {} } = {} as any);
console.log(namesOf(property, castProperty, shorthand));

let head: any;
for ([(head) = function () {}] of [[]] as any[][]) console.log(namesOf(head));
for ({ a: head! = () => {} } of [{}] as any[]) console.log(namesOf(head));

let parenthesizedValue: any, castValue: any, ownName: any;
(parenthesizedValue) = (function () {});
(castValue as any) = (() => {}) as any;
(ownName) = function own() {};
console.log(namesOf(parenthesizedValue, castValue, ownName));

const holder: any = {};
holder.member = function () {};
(holder.parenthesized) = function () {};
(holder.cast as any) = () => {};
holder["computed"] = class {};
[holder.element = function () {}] = [] as any[];
console.log(namesOf(holder.member, holder.parenthesized, holder.cast, holder.computed, holder.element));

// GENERATED: namesOf asserted castProperty
// CHECK-LABEL: function {{*}}name="namesOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array site=[[w_1]] flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=JSON
// CHECK-NEXT: v2 = PropGet v1 key="stringify"
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v0 key="map"
// CHECK-NEXT: v5 = NewClosure function=[[f_3]]
// CHECK-NEXT: v6 = Call v4, v0, v5 calleeKey="map" calleeName="values.map"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|Array site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v8 = Call v3, v1, v7 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: ReturnCall v8 casts=[{declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="asserted"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_6]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_6]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_6]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="castProperty"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
