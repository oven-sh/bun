// RUN: lower
// OPTIONS: builtin-modules

// Receivers below an accessor: Object.getOwnPropertyDescriptor hands the getter and the setter of a class back as plain functions, and the program calls them on a string, on nothing and on another class.
let total = 0;

class Account {
  balance = 10;
  get doubled(): number {
    total += this === undefined ? 100 : this instanceof Account ? 1 : 10000;
    return this === undefined ? -1 : this.balance * 2;
  }
  set doubled(value: number) {
    total += typeof value === "number" ? 1000000 : 100000000;
    this.balance = value / 2;
  }
}

class Wallet {
  balance = "30";
}

const account = new Account();
account.doubled = account.doubled + 2;
const { get, set } = Object.getOwnPropertyDescriptor(Account.prototype, "doubled")!;
const wallet = new Wallet();
set!.call(wallet, "50");
const all = Object.getOwnPropertyDescriptors(Account.prototype);
const results: unknown[] = [account.balance, get!.call(account), get!.call("text"), get!.call(undefined), get!.call(new Wallet()), wallet.balance, all.doubled.get!.call({ balance: [4] }), (account as any).__lookupGetter__("doubled") === get];
console.log(total, results.join());

// GENERATED: Account doubled
// CHECK-LABEL: function {{*}}name="Account"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_2]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="doubled"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_1]] site=[[w_3]]} results=[{type=number site=[[w_4]]}] {
// CHECK-NEXT: b0(v0: [[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="total"
// CHECK-NEXT: v3 = TypeTest v0 testedType=undefined
// CHECK-NEXT: Branch v3 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v5 = Integer integer=100
// CHECK-NEXT: Jump -> next b10(v5)
// CHECK-NEXT: b4(v6):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="Account"
// CHECK-NEXT: v9 = InstanceOf v0, v8 writtenExpression="this instanceof Account"
// CHECK-NEXT: v10 = ToBoolean v9
// CHECK-NEXT: Branch v10 -> taken b6(| 0), notTaken b8(| 0)
// CHECK-NEXT: b6(v11):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v12 = Integer integer=1
// CHECK-NEXT: Jump -> next b10(v12)
// CHECK-NEXT: b8(v13):
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: v14 = Integer integer=10000
// CHECK-NEXT: Jump -> next b10(v14)
// CHECK-NEXT: b10(v15):
// CHECK-NEXT: v16 = Add v2, v15
// CHECK-NEXT: v17 = Convert v16 declared={type=number site=[[w_7]]}
// CHECK-NEXT: v18 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v19 = CheckInitialized v18 name="total"
// CHECK-NEXT: PutModuleVariable v17 variable=[[g_5]]
// CHECK-NEXT: v21 = TypeTest v0 testedType=undefined
// CHECK-NEXT: Branch v21 -> taken b11(| 0), notTaken b13(| 0)
// CHECK-NEXT: b11(v22):
// CHECK-NEXT: Jump -> next b12()
// CHECK-NEXT: b12():
// CHECK-NEXT: v23 = Integer integer=-1
// CHECK-NEXT: Jump -> next b15(v23)
// CHECK-NEXT: b13(v24):
// CHECK-NEXT: Jump -> next b14()
// CHECK-NEXT: b14():
// CHECK-NEXT: v25 = PropGet v0 key="balance"
// CHECK-NEXT: v26 = Integer integer=2
// CHECK-NEXT: v27 = Mul v25, v26
// CHECK-NEXT: Jump -> next b15(v27)
// CHECK-NEXT: b15(v28):
// CHECK-NEXT: v29 = Convert v28 declared={type=number site=[[w_4]]}
// CHECK-NEXT: Return v29
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="doubled"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=[[L_1]] site=[[w_8]]} parameters=[{type=number site=[[w_9]]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_1]], v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="total"
// CHECK-NEXT: v4 = TypeTest v1 testedType=number
// CHECK-NEXT: Branch v4 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v6 = Integer integer=1000000
// CHECK-NEXT: Jump -> next b6(v6, v5)
// CHECK-NEXT: b4(v7):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v8 = Integer integer=100000000
// CHECK-NEXT: Jump -> next b6(v8, v7)
// CHECK-NEXT: b6(v9, v10: number):
// CHECK-NEXT: v11 = Add v3, v9
// CHECK-NEXT: v12 = Convert v11 declared={type=number site=[[w_7]]}
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v14 = CheckInitialized v13 name="total"
// CHECK-NEXT: PutModuleVariable v12 variable=[[g_5]]
// CHECK-NEXT: v16 = Integer integer=2
// CHECK-NEXT: v17 = Div v10, v16
// CHECK-NEXT: v18 = Convert v17 declared={type=number site=[[w_10]]}
// CHECK-NEXT: PropSet v0, v18 key="balance"
// CHECK-NEXT: v20 = Undefined
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
