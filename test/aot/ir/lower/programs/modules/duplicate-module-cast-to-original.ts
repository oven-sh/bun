// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 4

// FILE: main.ts
// The program has two copies of one module. Each declares a class with the same name and a private member, and an accessor returns either namespace cast to the first copy's type. Instances created from the returned class behave as in plain Bun.
function live(given: { token: string } | undefined): string | undefined {
  return given?.token;
}
async function refresh(generation: number, name: string): Promise<string | undefined> {
  const { keeperModule } = await import("./pick.ts");
  const { Keeper, describe } = keeperModule(generation);
  const keeper = new Keeper(name, { url: "u" });
  return describe(keeper) + " " + live(await keeper.tokens());
}
console.log(await refresh(1, "n"), "|", await refresh(1, ""));
console.log(await refresh(2, "n"), "|", await refresh(2, ""));

// FILE: keeper.ts
export class Keeper {
  private found?: {
    url: string;
    seen: boolean;
    served: string | undefined;
  };
  constructor(private readonly name: string, private readonly config: { url: string }) {}
  note(served: string | undefined): void {
    const found = { url: this.config.url, seen: true };
    this.found = { ...found, served };
  }
  async tokens(): Promise<{ token: string } | undefined> {
    this.note(this.name === "" ? undefined : this.name);
    return this.found?.seen ? { token: "one:" + this.found.url + ":" + this.found.served } : undefined;
  }
  label() {
    return "first";
  }
}
export function describe(keeper: Keeper): string {
  return keeper.label();
}

// FILE: pick.ts
export function keeperModule(generation: number): typeof import("./keeper.ts") {
  if (generation === 2) {
    return require("./v2/keeper.ts") as typeof import("./keeper.ts");
  }
  return require("./keeper.ts") as typeof import("./keeper.ts");
}

// FILE: v2/keeper.ts
export class Keeper {
  private found?: {
    url: string;
    seen: boolean;
    served: string | undefined;
  };
  constructor(private readonly name: string, private readonly config: { url: string }) {}
  note(served: string | undefined): void {
    const found = { url: this.config.url, seen: true };
    this.found = { ...found, served };
  }
  async tokens(): Promise<{ token: string } | undefined> {
    this.note(this.name === "" ? undefined : this.name);
    return this.found?.seen ? { token: "two:" + this.found.url + ":" + this.found.served } : undefined;
  }
  label() {
    return "second";
  }
}
export function describe(keeper: Keeper): string {
  return keeper.label();
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: live refresh
// CHECK-LABEL: function {{*}}name="live"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull]}] results=[{type=undefined|null|string site=[[w_3]] flags=[OmitsNull]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: Jump -> next b5(v3)
// CHECK-NEXT: b4(v4):
// CHECK-NEXT: v5 = PropGet v4 key="token"
// CHECK-NEXT: Jump -> next b5(v5)
// CHECK-NEXT: b5(v6):
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="refresh"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=number site=[[w_4]]}, {type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Promise<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: number, v2: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = ImportModule module=[[m_6]] referrer=[[m_0]]
// CHECK-NEXT: v4 = Await v3, v1, v2
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|object site=[[w_7]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v6 = TypeTest v5 testedType=undefined|null
// CHECK-NEXT: Branch v6 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v8 = NewRuntimeError runtimeError=NotDestructurable name="keeperModule"
// CHECK-NEXT: Throw v8
// CHECK-NEXT: b4(v9):
// CHECK-NEXT: v10 = PropGet v9 key="keeperModule"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[f_8]]} illTypedCause=Assertion
// CHECK-NEXT: v12 = Call v11, -, v1 calleeName="keeperModule"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|object site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v14 = TypeTest v13 testedType=undefined|null
// CHECK-NEXT: Branch v14 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v15):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() frequency=Unlikely:
// CHECK-NEXT: v16 = NewRuntimeError runtimeError=NotDestructurable name="Keeper"
// CHECK-NEXT: Throw v16
// CHECK-NEXT: b7(v17):
// CHECK-NEXT: v18 = PropGet v17 key="Keeper"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|[[f_10]]} illTypedCause=Assertion
// CHECK-NEXT: v20 = PropGet v17 key="describe"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|[[f_11]]} illTypedCause=Assertion
// CHECK-NEXT: v22 = Data data=[[d_12]]
// CHECK-NEXT: v23 = Construct v19, -, v2, v22 calleeName="Keeper"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|[[L_13]] site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v25 = Call v21, -, v24 calleeName="describe"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|string site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v27 = String string=" "
// CHECK-NEXT: v28 = Add v26, v27
// CHECK-NEXT: v29 = GetModuleVariable variable=[[g_16]]
// CHECK-NEXT: v30 = PropGet v24 key="tokens"
// CHECK-NEXT: v31 = Call v30, v24 calleeKey="tokens" calleeName="keeper.tokens"
// CHECK-NEXT: v32 = Convert v31 declared={type=undefined|null|Promise<undefined|null|[[L_1]]> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v33 = Await v32, v1, v2
// CHECK-NEXT: v34 = Convert v33 declared={type=undefined|null|[[L_1]] site=[[w_17]] flags=[OmitsNull]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v35 = Call v29, -, v34 calleeName="live"
// CHECK-NEXT: v36 = Convert v35 declared={type=undefined|null|string site=[[w_18]] flags=[OmitsNull]}
// CHECK-NEXT: v37 = Add v28, v36
// CHECK-NEXT: v38 = Convert v37 declared={type=undefined|null|string|object site=[[w_19]]}
// CHECK-NEXT: Return v38
// CHECK-NEXT: }
