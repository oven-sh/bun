// RUN: lower
// OPTIONS: builtin-modules

// A sealed object and an object that is not extensible take stores to the properties they have and refuse new ones, a frozen object refuses both, and a definition of a class field needs an extensible object.
class Account {
  constructor(balance) {
    this.balance = balance;
    this.moves = 0;
  }
}
class Closed {
  constructor(how) {
    this.first = 1;
    how(this);
  }
}
class BelowClosed extends Closed {
  second = 2;
}

function replace(account, amount) {
  account.balance = amount;
  account.moves = account.moves + 1;
  return account.balance + account.moves;
}
function create(account, note) {
  account.note = note;
  return account.note;
}
function createByKey(account, key, note) {
  account[key] = note;
  return account[key];
}
function remove(account) {
  return delete account.moves;
}
function attempt(name, action) {
  try {
    return `${name} ${action()}`;
  } catch (error) {
    return `${name} ${error.constructor.name}`;
  }
}

const ways = {
  open: object => object,
  preventExtensions: Object.preventExtensions,
  seal: Object.seal,
  freeze: Object.freeze,
};
for (const [way, change] of Object.entries(ways)) {
  const account = new Account(1);
  let sum = 0;
  for (let i = 0; i < 100; i++) sum += replace(account, i);
  change(account);
  const lines = [];
  for (let i = 0; i < 3; i++) lines.push(attempt("replace", () => replace(account, 10 + i)));
  lines.push(attempt("create", () => create(account, "a")));
  lines.push(attempt("createByKey", () => createByKey(account, "other", "b")));
  lines.push(attempt("remove", () => remove(account)));
  lines.push(attempt("createAgain", () => replace(account, 20)));
  lines.push(attempt("define", () => Object.keys(new BelowClosed(change)).join()));
  console.log(way, sum, lines.join(" | "), JSON.stringify(account), Object.isExtensible(account), Object.isSealed(account), Object.isFrozen(account));
}

const late = new Account(5);
create(late, "early");
Object.seal(late);
console.log(attempt("storeToLateField", () => create(late, "later")), JSON.stringify(late));

// GENERATED: createByKey remove attempt Closed BelowClosed open
// CHECK-LABEL: function {{*}}name="createByKey"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=3 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}, {type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|object, v1: undefined|null|string, v2: undefined|null|string):
// CHECK-NEXT: ElemSet v0, v1, v2
// CHECK-NEXT: v4 = ElemGet v0, v1
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="remove"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: v1 = PropDelete v0 key="moves"
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v2 = ToString v0
// CHECK-NEXT: v3 = String string=" "
// CHECK-NEXT: v4 = Call v1 calleeName="action"
// CHECK-NEXT: v5 = ToString v4
// CHECK-NEXT: v6 = Strcat v2, v3, v5
// CHECK-NEXT: Return v6
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v7 = CatchValue
// CHECK-NEXT: v8 = ToString v0
// CHECK-NEXT: v9 = String string=" "
// CHECK-NEXT: v10 = PropGet v7 key="constructor"
// CHECK-NEXT: v11 = PropGet v10 key="name"
// CHECK-NEXT: v12 = ToString v11
// CHECK-NEXT: v13 = Strcat v8, v9, v12
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Closed"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|function):
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_3]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_3]]}
// CHECK-NEXT: v5 = Integer integer=1
// CHECK-NEXT: PropSet v4, v5 key="first"
// CHECK-NEXT: v7 = Call v1, -, v4 calleeName="how"
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: v9 = TypeTest v8 testedType=object
// CHECK-NEXT: Branch v9 -> taken b1(| 0), notTaken b2(v4)
// CHECK-NEXT: b1(v10):
// CHECK-NEXT: Jump -> next b2(v10)
// CHECK-NEXT: b2(v11):
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="BelowClosed"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_5]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_5]]}
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_6]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="open"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
