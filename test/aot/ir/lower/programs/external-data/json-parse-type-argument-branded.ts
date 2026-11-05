// RUN: lower
// OPTIONS: builtin-modules

// A branded primitive, `string & { readonly __brand: "UserId" }`, is parsed as the primitive: no value has the brand at run time.
type UserId = string & { readonly __brand: "UserId" };
type Cents = number & { readonly __brand: "Cents" };
type Level = ("low" | "high") & { readonly __level: true };
type Path = `/${string}` & { readonly __brand: "Path" };
type Loose = string & {};
interface Account { id: UserId; balance: Cents; level: Level; home?: Path; note: Loose; friends: UserId[] }
function describe(run: () => unknown): string {
  try {
    return JSON.stringify(run());
  } catch (error) {
    return String(error);
  }
}
const texts = [
  '{"id":"u1","balance":250,"level":"low","home":"/u1","note":"","friends":["u2","u3"]}',
  '{"id":"u1","balance":250,"level":"high","note":"n","friends":[]}',
  '{"id":1,"balance":"250","level":"middle","home":"u1","note":null,"friends":["u2",3]}',
  '{"id":{"__brand":"UserId"},"balance":1,"level":"low","note":"","friends":[]}',
];
for (const text of texts) console.log(describe(() => JSON.parse(text) as Account));
console.log(describe(() => JSON.parse('"u9"') as UserId), describe(() => JSON.parse("9") as UserId), describe(() => JSON.parse("1.5") as Cents), describe(() => JSON.parse('"high"') as Level), describe(() => JSON.parse('"none"') as Level));
const account = JSON.parse(texts[0]) as Account;
const shout = (id: UserId): string => id.toUpperCase() + account.friends.length;
console.log(shout(account.id), account.balance + 1, account.level.length, account.home?.slice(1));

// GENERATED: describe shout
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v1 = Builtin builtin=JSON
// CHECK-NEXT: v2 = PropGet v1 key="stringify"
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v4 = Call v0 calleeName="run"
// CHECK-NEXT: v5 = Call v3, v1, v4 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Return v6
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v7 = CatchValue
// CHECK-NEXT: v8 = Builtin builtin=String
// CHECK-NEXT: v9 = Call v8, -, v7 calleeName="String"
// CHECK-NEXT: ReturnCall v9 casts=[{declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="shout"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="toUpperCase"
// CHECK-NEXT: v2 = Call v1, v0 calleeKey="toUpperCase" calleeName="id.toUpperCase"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="account"
// CHECK-NEXT: v6 = PropGet v5 key="friends"
// CHECK-NEXT: v7 = PropGet v6 key="length"
// CHECK-NEXT: v8 = Convert v7 declared={type=number site=[[w_11]]} illTypedCause=Assertion
// CHECK-NEXT: v9 = Add v3, v8
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
