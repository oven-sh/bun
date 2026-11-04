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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[OmitsNull]}] results=[{type=undefined|null|string flags=[OmitsNull]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: Jump -> next b3(v3)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: v5 = PropGet v4 key="token"
// CHECK-NEXT: Jump -> next b3(v5)
// CHECK-NEXT: b3(v6):
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string flags=[OmitsNull]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="refresh"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, IsChecked, HasExplicitName] length=2 syntax=[HasWrittenAwait] thisType={type=anything} parameters=[{type=number}, {type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Promise<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: number, v2: undefined|null|string):
// CHECK-NEXT: v3 = ImportModule module=[[m_2]] referrer=[[m_0]]
// CHECK-NEXT: v4 = Await v3, v1, v2
// CHECK-NEXT: v5 = TypeTest v4 testedType=undefined|null
// CHECK-NEXT: Branch v5 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v6):
// CHECK-NEXT: v7 = NewRuntimeError runtimeError=NotDestructurable name="keeperModule"
// CHECK-NEXT: Throw v7
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: v9 = PropGet v8 key="keeperModule"
// CHECK-NEXT: v10 = Call v9, -, v1 calleeName="keeperModule"
// CHECK-NEXT: v11 = TypeTest v10 testedType=undefined|null
// CHECK-NEXT: Branch v11 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v12):
// CHECK-NEXT: v13 = NewRuntimeError runtimeError=NotDestructurable name="Keeper"
// CHECK-NEXT: Throw v13
// CHECK-NEXT: b4(v14):
// CHECK-NEXT: v15 = PropGet v14 key="Keeper"
// CHECK-NEXT: v16 = PropGet v14 key="describe"
// CHECK-NEXT: v17 = Data data=[[d_3]]
// CHECK-NEXT: v18 = Construct v15, -, v2, v17 calleeName="Keeper"
// CHECK-NEXT: v19 = Call v16, -, v18 calleeName="describe"
// CHECK-NEXT: v20 = String string=" "
// CHECK-NEXT: v21 = Add v19, v20
// CHECK-NEXT: v22 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v23 = PropGet v18 key="tokens"
// CHECK-NEXT: v24 = Call v23, v18 calleeKey="tokens" calleeName="keeper.tokens"
// CHECK-NEXT: v25 = Await v24, v1, v2
// CHECK-NEXT: v26 = Call v22, -, v25 calleeName="live"
// CHECK-NEXT: v27 = Add v21, v26
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|string|object}
// CHECK-NEXT: Return v28
// CHECK-NEXT: }
