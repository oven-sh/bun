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
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="Resource"
// CHECK-NEXT: v2 = String string="b"
// CHECK-NEXT: v3 = Construct v1, -, v2 calleeName="Resource"
// CHECK-NEXT: v4 = Builtin builtin=CompilerHelpersGetDisposeMethod [isNotReadFromHolder]
// CHECK-NEXT: v5 = Call v4, -, v3
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b8():
// CHECK-NEXT: v6 = NewClosure function=[[f_2]]
// CHECK-NEXT: PropSet v3, v6 key=@@dispose
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="log"
// CHECK-NEXT: v10 = PropGet v9 key="push"
// CHECK-NEXT: v11 = String string="body "
// CHECK-NEXT: v12 = PropGet v3 key="name"
// CHECK-NEXT: v13 = Add v11, v12
// CHECK-NEXT: v14 = Call v10, v9, v13 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v15 = Convert v14 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: v16 = TypeTest v5 testedType=undefined
// CHECK-NEXT: Branch v16 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v17):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b4(v18):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b7():
// CHECK-NEXT: v19 = Call v18, v3
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v20 = Undefined
// CHECK-NEXT: Return v20
// CHECK-NEXT: b7() role=CatchHandler:
// CHECK-NEXT: v21 = CatchValue
// CHECK-NEXT: Throw v21
// CHECK-NEXT: b8() role=DisposalCleanup subject=v3:
// CHECK-NEXT: v22 = CatchValue
// CHECK-NEXT: v23 = TypeTest v5 testedType=undefined
// CHECK-NEXT: Branch v23 -> taken b11(), notTaken b9(| 0)
// CHECK-NEXT: b9(v24):
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10() handler=b12():
// CHECK-NEXT: v25 = Call v24, v3
// CHECK-NEXT: Jump -> next b11()
// CHECK-NEXT: b11():
// CHECK-NEXT: Throw v22
// CHECK-NEXT: b12() role=CatchHandler:
// CHECK-NEXT: v26 = CatchValue
// CHECK-NEXT: v27 = NewSuppressedError v26, v22
// CHECK-NEXT: Throw v27
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.asyncDispose]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsAsync, HasThis, IsChecked, IsNamedByComputedKey] thisType={type=[[L_4]]} results=[{type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_4]]):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="log"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = String string="class async dispose "
// CHECK-NEXT: v5 = PropGet v0 key="name"
// CHECK-NEXT: v6 = Add v4, v5
// CHECK-NEXT: v7 = Call v3, v2, v6 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v8 = Convert v7 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
