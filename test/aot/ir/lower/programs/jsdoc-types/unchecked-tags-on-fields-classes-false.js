// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 1

// FILE: main.js
// Unchecked tags on fields of classes are false.
function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label, run) {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Account {
  /** @type {number} */
  balance = "100";

  /** @type {string} */
  owner = 7;

  /** @type {number[]} */
  history = "none";

  /** @type {{ x: number, y: number }} */
  place = null;

  /** @type {number} */
  never;

  /** @type {number} */
  static count = "zero";

  /** @type {number} */
  #hidden = "hidden";

  constructor() {
    /** @type {number} */
    this.limit = [5];
    /** @type {boolean} */
    this.open = "yes";
  }

  /** @returns {number} */
  total() {
    return this.balance + this.limit;
  }

  /** @returns {number} */
  hidden() {
    return this.#hidden + 1;
  }

  /** @param {number} amount */
  deposit(amount) {
    this.balance += amount;
    return this.balance;
  }
}

class Honest {
  /** @type {number} */
  n = 1;
  /** @type {string} */
  s = "s";
  /** @returns {number} */
  next() {
    return this.n + 1;
  }
}

class Late {
  /** @type {number} */
  n = 1;
  /** @returns {number} */
  next() {
    return this.n + 1;
  }
}

class Base {
  /** @type {number} */
  value = 1;
  /** @returns {number} */
  twice() {
    return this.value * 2;
  }
}

class Heir extends Base {
  /** @type {number} */
  value = "heir";
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += new Honest().next() + new Late().next() + new Base().twice();
console.log("2000 honest rounds: " + warm);

attempt("fields as they were made", () => {
  const a = new Account();
  return [a.balance, a.owner, a.history, a.place, a.never, a.limit, a.open, Account.count, Object.keys(a).join(), JSON.stringify(a)];
});
attempt("their kinds", () => {
  const a = new Account();
  return [typeof a.balance, typeof a.owner, typeof a.history, typeof a.place, typeof a.never, typeof a.limit, typeof a.open, typeof Account.count];
});
attempt("arithmetic", () => {
  const a = new Account();
  return [a.balance + 1, a.balance * 2, a.owner + 1, a.never + 1, a.limit + 1, Account.count + 1, a.total(), a.hidden()];
});
attempt("updates", () => {
  const a = new Account();
  return [a.deposit(1), a.deposit("2"), a.balance, ++a.never, a.limit++, a.limit, ++Account.count];
});
attempt("a member of a field that is null", () => new Account().place.x);
attempt("the list that is a text", () => {
  const a = new Account();
  return [a.history.length, a.history[0], [...a.history].length];
});
attempt("the list that is a text, pushed to", () => new Account().history.push(1));
attempt("the text that is a number", () => new Account().owner.length);
attempt("stored honestly afterwards", () => {
  const a = new Account();
  a.balance = 1;
  a.limit = 2;
  a.owner = "o";
  a.place = { x: 1, y: 2 };
  return [a.total(), a.owner.length, a.place.x + a.place.y, JSON.stringify(a)];
});
attempt("an honest class gets other values later", () => {
  const late = new Late();
  const seen = [late.next()];
  for (const value of ["1", null, undefined, [1], { valueOf: () => 1 }, 1n === 1n, 2]) {
    late.n = value;
    seen.push(late.next());
  }
  return seen;
});
attempt("a subclass declares the same type and stores another kind", () => [new Heir().value, new Heir().twice(), new Base().twice(), Object.keys(new Heir()).join()]);
attempt("honest again", () => [new Honest().next(), new Late().next(), new Base().twice()]);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "checkJs": false }, "files": [] }

// GENERATED: Account hidden deposit twice Heir valueOf
// CHECK-LABEL: function {{*}}name="Account"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_3]]
// CHECK-NEXT: v5 = Convert v3 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v6 = Data data=[[d_4]]
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|Array<number> flags=[IsExpected]}
// CHECK-NEXT: v8 = Convert v7 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropSet v5, v8 key="limit"
// CHECK-NEXT: v10 = Convert v3 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v11 = String string="yes"
// CHECK-NEXT: v12 = Convert v11 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: PropSet v10, v12 key="open"
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: v15 = TypeTest v14 testedType=object
// CHECK-NEXT: Branch v15 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v16):
// CHECK-NEXT: Jump -> next b4(v16)
// CHECK-NEXT: b3(v17):
// CHECK-NEXT: Jump -> next b4(v3)
// CHECK-NEXT: b4(v18):
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="hidden"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] thisType={type=[[L_2]] flags=[IsExpected]} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: [[L_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v3 = PrivateGet v1, v2 layout=[[L_2]] field=6
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v5 = Integer integer=1
// CHECK-NEXT: v6 = Add v4, v5
// CHECK-NEXT: v7 = Convert v6 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="deposit"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] length=1 thisType={type=[[L_2]] flags=[IsExpected]} parameters=[{type=number flags=[IsExpected]}] results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: [[L_2]], v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="balance"
// CHECK-NEXT: v4 = Add v3, v1
// CHECK-NEXT: v5 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropSet v2, v5 key="balance"
// CHECK-NEXT: v7 = Convert v0 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v8 = PropGet v7 key="balance"
// CHECK-NEXT: v9 = Convert v8 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="twice"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] thisType={type=[[L_8]] flags=[IsExpected]} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: [[L_8]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: v2 = PropGet v1 key="value"
// CHECK-NEXT: v3 = Convert v2 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v4 = Integer integer=2
// CHECK-NEXT: v5 = Mul v3, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Heir"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_11]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_11]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_12]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="valueOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
