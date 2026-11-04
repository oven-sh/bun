// RUN: lower
// OPTIONS: builtin-modules

// A generic union of object types, one instantiation of which comes from JSON.
declare const console: { log(...values: unknown[]): void };
type Either<A, B> = { early: A; late?: undefined } | { late: B; early?: undefined };
function text<A, B>(e: Either<A, B>): string {
  if (e.early !== undefined) {
    const early = e.early;
    return 'early ' + String(early);
  }
  return 'late ' + String(e.late);
}
function make<A, B>(a: A): Either<A, B> {
  return { early: a };
}
function keys(e: Either<number, string>): string {
  return Object.keys(e).join();
}
const parsed = JSON.parse('{"early":"s"}') as Either<string, number>;
console.log(text(parsed));
const other = JSON.parse('{"late":4,"more":true}') as Either<string, number>;
console.log(text(other), Object.keys(other).join());
const made: Either<number, string> = { late: 'x' };
console.log(text(made), keys(made));
console.log(text(make<boolean, string>(true)));
const list: Either<string, number>[] = [parsed, { early: 'own' }, other];
console.log(list.map(e => text(e)).join());
// Nothing is copied on the way: the names that the type does not say are there, and the object is itself.
function names<A, B>(e: Either<A, B>): string {
  return Object.keys(e).join();
}
function held<A, B>(e: Either<A, B>): Either<A, B> {
  return e;
}
let kept: Either<boolean, number> | undefined;
function keep(e: Either<boolean, number>): void {
  kept = e;
}
console.log(names(other), held(other) === other, names(held(other)));
const third = JSON.parse('{"late":5,"more":1}') as Either<boolean, number>;
keep(third);
console.log(kept === third, kept && names(kept));

// GENERATED: text make keys keep
// CHECK-LABEL: function {{*}}name="text"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: v1 = PropGet v0 key="early"
// CHECK-NEXT: v2 = TypeTest v1 testedType=undefined
// CHECK-NEXT: Branch v2 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v3):
// CHECK-NEXT: v4 = String string="late "
// CHECK-NEXT: v5 = Builtin builtin=String
// CHECK-NEXT: v6 = PropGet v0 key="late"
// CHECK-NEXT: v7 = Call v5, -, v6 calleeName="String"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v9 = Add v4, v8
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: b2(v11):
// CHECK-NEXT: v12 = PropGet v0 key="early"
// CHECK-NEXT: v13 = String string="early "
// CHECK-NEXT: v14 = Builtin builtin=String
// CHECK-NEXT: v15 = Call v14, -, v12 calleeName="String"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v17 = Add v13, v16
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = NewObject -, v0 layout=[[L_2]] fields=[0]
// CHECK-NEXT: v2 = FinishObject v1
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="keys"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeName="Object.keys"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v5 = PropGet v4 key="join"
// CHECK-NEXT: v6 = Call v5, v4 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v6 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="keep"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="kept"
// CHECK-NEXT: v3 = Convert v0 declared={type=undefined|null|[[L_1]] flags=[OmitsNull]}
// CHECK-NEXT: PutModuleVariable v3 variable=[[g_3]]
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
