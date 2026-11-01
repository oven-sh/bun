// RUN: lower
// OPTIONS: builtin-modules

// The dispose method is replaced after the resource was declared.
const log: string[] = [];

class Resource {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  [Symbol.dispose](): void {
    log.push("class dispose " + this.name);
  }
}

class AsyncResource {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  async [Symbol.asyncDispose](): Promise<void> {
    log.push("class async dispose " + this.name);
  }
}

function line(label: string): void {
  console.log(label + ": " + log.join(", "));
  log.length = 0;
}

function plain(): void {
  using r = new Resource("a");
  log.push("body " + r.name);
}

function replacedInTheBody(): void {
  using r = new Resource("b");
  r[Symbol.dispose] = () => {
    log.push("own dispose");
  };
  log.push("body " + r.name);
}

function replacedBefore(): void {
  const made = new Resource("c");
  made[Symbol.dispose] = () => {
    log.push("own dispose, set before");
  };
  using r = made;
  log.push("body " + r.name);
}

function prototypeReplacedInTheBody(): void {
  using r = new Resource("d");
  Resource.prototype[Symbol.dispose] = function () {
    log.push("patched dispose " + this.name);
  };
  log.push("body " + r.name);
}

function two(): void {
  using first = new Resource("first");
  using second = new Resource("second");
  log.push("body " + first.name + " " + second.name);
}

async function asynchronous(): Promise<void> {
  await using r = new AsyncResource("e");
  r[Symbol.asyncDispose] = async () => {
    log.push("own async dispose");
  };
  log.push("body " + r.name);
}

const original = Resource.prototype[Symbol.dispose];

for (let i = 0; i < 2000; i++) plain();
console.log("2000 honest: " + log.length);
log.length = 0;

plain();
line("nothing replaced");
replacedInTheBody();
line("an own member appears in the body");
replacedBefore();
line("an own member from before the declaration");
prototypeReplacedInTheBody();
line("the prototype's is replaced in the body");
plain();
line("the next resource");
two();
line("two resources");
Resource.prototype[Symbol.dispose] = original;
two();
line("put back");
await asynchronous();
line("an asynchronous one");

export {};

// GENERATED: replacedInTheBody [Symbol.asyncDispose]
// CHECK-LABEL: function {{*}}name="replacedInTheBody"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="Resource"
// CHECK-NEXT: v2 = String string="b"
// CHECK-NEXT: v3 = Construct v1, -, v2 calleeName="Resource"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v5 = Builtin builtin=CompilerHelpersGetDisposeMethod [isNotReadFromHolder]
// CHECK-NEXT: v6 = Call v5, -, v4
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b12():
// CHECK-NEXT: v7 = NewClosure function=[[f_4]]
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[f_5]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v4, v8 key=@@dispose
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="log"
// CHECK-NEXT: v12 = PropGet v11 key="push"
// CHECK-NEXT: v13 = String string="body "
// CHECK-NEXT: v14 = PropGet v4 key="name"
// CHECK-NEXT: v15 = Add v13, v14
// CHECK-NEXT: v16 = Call v12, v11, v15 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v17 = Convert v16 declared={type=number site=[[w_8]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v18 = TypeTest v6 testedType=undefined
// CHECK-NEXT: Branch v18 -> taken b4(| 0), notTaken b6(| 0)
// CHECK-NEXT: b4(v19):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b6(v20):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7() handler=b11():
// CHECK-NEXT: v21 = Call v20, v4
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v22 = Undefined
// CHECK-NEXT: Return v22
// CHECK-NEXT: b11() role=CatchHandler:
// CHECK-NEXT: v23 = CatchValue
// CHECK-NEXT: Throw v23
// CHECK-NEXT: b12() role=DisposalCleanup subject=v4:
// CHECK-NEXT: v24 = CatchValue
// CHECK-NEXT: v25 = TypeTest v6 testedType=undefined
// CHECK-NEXT: Branch v25 -> taken b13(| 0), notTaken b15(| 0)
// CHECK-NEXT: b13(v26):
// CHECK-NEXT: Jump -> next b14()
// CHECK-NEXT: b14():
// CHECK-NEXT: Jump -> next b18()
// CHECK-NEXT: b15(v27):
// CHECK-NEXT: Jump -> next b16()
// CHECK-NEXT: b16() handler=b19():
// CHECK-NEXT: v28 = Call v27, v4
// CHECK-NEXT: Jump -> next b17()
// CHECK-NEXT: b17():
// CHECK-NEXT: Jump -> next b18()
// CHECK-NEXT: b18():
// CHECK-NEXT: Throw v24
// CHECK-NEXT: b19() role=CatchHandler:
// CHECK-NEXT: v29 = CatchValue
// CHECK-NEXT: v30 = NewSuppressedError v29, v24
// CHECK-NEXT: Throw v30
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.asyncDispose]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsAsync, HasThis, IsChecked, IsNamedByComputedKey] thisType={type=[[L_9]] site=[[w_10]]} results=[{type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: [[L_9]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="log"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = String string="class async dispose "
// CHECK-NEXT: v5 = PropGet v0 key="name"
// CHECK-NEXT: v6 = Add v4, v5
// CHECK-NEXT: v7 = Call v3, v2, v6 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v8 = Convert v7 declared={type=number site=[[w_12]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
