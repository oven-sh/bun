// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1

// FILE: main.ts
// A member whose type a spread or a mapped type computes from a type in a declaration file is not tested: the declaration file may be wrong.
import type { Port, Stringify } from "./host";
const input: any = { a: 5, port: "eighty" };
const row = (name: string, f: () => unknown) => { let r: unknown; try { r = f(); } catch (e) { r = "THROWS " + (e as Error).message.split(" (bun")[0]; } console.log(name + ": " + JSON.stringify(r)); };
const kind = (v: unknown) => typeof v + " " + JSON.stringify(v);
interface Config { a: number }
interface Settings { port: Port }
interface Ports { [name: string]: Port }
row("a spread of a mapped type from the declaration file", () => { const stringified: Stringify<Config> = input; const copy = { ...stringified }; return kind(copy.a); });
row("a spread of an interface", () => { const settings: Settings = input; const copy = { ...settings }; return kind(copy.port); });
row("a library mapped type", () => { const settings: Partial<Settings> = input; return kind(settings.port); });
row("a library mapped type over an index signature", () => { const ports: Readonly<Ports> = input; return kind(ports.port); });
row("a mapped type in the program", () => { const ports: { [K in keyof Settings]: Port } = input; return kind(ports.port); });
row("a member typed by the program alone", () => { const config: Partial<Config> = { a: 1 }; const copy = { ...config }; return kind(copy.a); });

// FILE: host.d.ts
// What a package's declaration file says of the host's settings, for main.ts.
export type Port = number;
export type Stringify<T> = { [K in keyof T]: string };

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: row kind
// CHECK-LABEL: function {{*}}name="row"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b5():
// CHECK-NEXT: v3 = Call v1 calleeName="f"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b5():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b6(v3)
// CHECK-NEXT: b5() role=CatchHandler:
// CHECK-NEXT: v4 = CatchValue
// CHECK-NEXT: v5 = String string="THROWS "
// CHECK-NEXT: v6 = Convert v4 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v7 = PropGet v6 key="message"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string site=[[w_5]]} illTypedCause=Assertion
// CHECK-NEXT: v9 = PropGet v8 key="split"
// CHECK-NEXT: v10 = String string=" (bun"
// CHECK-NEXT: v11 = Call v9, v8, v10 calleeKey="split" calleeName="e.message.split"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Array<undefined|null|string> site=[[w_6]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v13 = Integer
// CHECK-NEXT: v14 = ElemGet v12, v13
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v16 = Add v5, v15
// CHECK-NEXT: Jump -> next b6(v16)
// CHECK-NEXT: b6(v17):
// CHECK-NEXT: v18 = Builtin builtin=GlobalThis
// CHECK-NEXT: v19 = PropGet v18 key="console" [isFreeName]
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v21 = PropGet v20 key="log"
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v23 = String string=": "
// CHECK-NEXT: v24 = Add v0, v23
// CHECK-NEXT: v25 = Builtin builtin=JSON
// CHECK-NEXT: v26 = PropGet v25 key="stringify"
// CHECK-NEXT: v27 = Convert v26 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v28 = Call v27, v25, v17 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v29 = Convert v28 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v30 = Add v24, v29
// CHECK-NEXT: v31 = Call v22, v20, v30 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v32 = Undefined
// CHECK-NEXT: Return v32
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="kind"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeOf v0
// CHECK-NEXT: v2 = String string=" "
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = Builtin builtin=JSON
// CHECK-NEXT: v5 = PropGet v4 key="stringify"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v7 = Call v6, v4, v0 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v9 = Add v3, v8
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
