// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2

// FILE: main.ts
// A literal with a spread satisfies the type of the optional parameter of an async generator method and is passed to it.
declare const console: { log(...values: unknown[]): void };
import { C } from "./lib";
function f(a: string, b: number): Omit<NonNullable<Parameters<C["callService"]>[1]>, "x" | "y" | "z"> { return { timeout: b, headers: { a } } }
function words(e: unknown) { return "THROWN: " + (e as Error).message.split("\n").slice(0, 2).join(" | ").slice(0, 260) }
class S { c = new C(); tag?: () => string;
  get() { return this.c }
  run = async (flag: boolean): Promise<string> => {
    const out: string[] = [];
    try {
      const o = { ...f("a", 1), x: 1, y: "y", z: flag ? undefined : this.tag?.() } satisfies Parameters<C["callService"]>[1];
      for await (const line of this.get().callService("q", o)) out.push(line);
    } catch (e) { out.push(words(e)) }
    return out.join();
  }
}
console.log(await new S().run(false));
console.log(await new S().run(true));

// FILE: lib.ts
export class C { async *callService(a: string, opts?: { k1?: string; k2?: number; timeout?: number; headers?: Record<string, string>; retries?: number; o0?: number; o1?: number; o2?: number; o3?: number; o4?: number; o5?: number; o6?: number; o7?: number; o8?: number; o9?: number; o10?: number; o11?: number; o12?: number; o13?: number; o14?: number; o15?: number; o16?: number; o17?: number; o18?: number; o19?: number; o20?: number; o21?: number; o22?: number; o23?: number; o24?: number; o25?: number; o26?: number; o27?: number; o28?: number; o29?: number; o30?: number; o31?: number; o32?: number; o33?: number; o34?: number; o35?: number; o36?: number; o37?: number; o38?: number; o39?: number; u0?: unknown; a0?: any; u1?: unknown; a1?: any; u2?: unknown; a2?: any; x: number; y: string; z?: string }): AsyncGenerator<string> { yield a + " " + (opts ? opts.x + " " + opts.y + " " + opts.z + " " + opts.timeout + " " + Object.keys(opts).join() : "none") } }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: f words S get
// CHECK-LABEL: function {{*}}name="f"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=number}] results=[{type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: number):
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|number}
// CHECK-NEXT: v3 = NewObject layout=[[L_2]]
// CHECK-NEXT: PropDefine v3, v0 key="a"
// CHECK-NEXT: v5 = FinishObject v3
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|object flags=[OmitsNull]}
// CHECK-NEXT: v7 = NewObject -, v2, v6 layout=[[L_1]] fields=[47, 3]
// CHECK-NEXT: v8 = FinishObject v7
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="words"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = String string="THROWN: "
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = PropGet v2 key="message"
// CHECK-NEXT: v4 = PropGet v3 key="split"
// CHECK-NEXT: v5 = String string="\n"
// CHECK-NEXT: v6 = Call v4, v3, v5 calleeKey="split" calleeName="e.message.split"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v8 = PropGet v7 key="slice"
// CHECK-NEXT: v9 = Integer
// CHECK-NEXT: v10 = Integer integer=2
// CHECK-NEXT: v11 = Call v8, v7, v9, v10 calleeKey="slice" calleeName="slice"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v13 = PropGet v12 key="join"
// CHECK-NEXT: v14 = String string=" | "
// CHECK-NEXT: v15 = Call v13, v12, v14 calleeKey="join" calleeName="join"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v17 = PropGet v16 key="slice"
// CHECK-NEXT: v18 = Integer
// CHECK-NEXT: v19 = Integer integer=260
// CHECK-NEXT: v20 = Call v17, v16, v18, v19 calleeKey="slice" calleeName="slice"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v22 = Add v1, v21
// CHECK-NEXT: Return v22
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="S"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_3]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_3]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_4]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_3]]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_3]]):
// CHECK-NEXT: v1 = PropGet v0 key="c"
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
