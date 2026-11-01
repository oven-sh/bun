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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="early"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[L_4]]} illTypedCause=Assertion
// CHECK-NEXT: v3 = TypeTest v2 testedType=undefined
// CHECK-NEXT: Branch v3 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v5 = String string="late "
// CHECK-NEXT: v6 = Builtin builtin=String
// CHECK-NEXT: v7 = PropGet v0 key="late"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[L_5]]} illTypedCause=Assertion
// CHECK-NEXT: v9 = Call v6, -, v8 calleeName="String"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v11 = Add v5, v10
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v14 = PropGet v0 key="early"
// CHECK-NEXT: v15 = String string="early "
// CHECK-NEXT: v16 = Builtin builtin=String
// CHECK-NEXT: v17 = Call v16, -, v14 calleeName="String"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v19 = Add v15, v18
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_8]] site=[[w_9]]}] results=[{type=undefined|null|[[L_1]] site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_8]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_8]]} illTypedCause=FromLooseType
// CHECK-NEXT: v2 = NewObject -, v1 layout=[[L_11]] fields=[0]
// CHECK-NEXT: v3 = FinishObject v2
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_1]] site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="keys"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeName="Object.keys"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<undefined|null|string> site=[[w_14]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v5 = PropGet v4 key="join"
// CHECK-NEXT: v6 = Call v5, v4 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v6 casts=[{declared={type=undefined|null|string site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="keep"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_16]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="kept"
// CHECK-NEXT: v3 = Convert v0 declared={type=undefined|null|[[L_1]] site=[[w_17]] flags=[OmitsNull]}
// CHECK-NEXT: PutModuleVariable v3 variable=[[g_16]]
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
