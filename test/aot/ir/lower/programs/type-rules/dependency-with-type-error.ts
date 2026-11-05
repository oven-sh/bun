// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS100009 1
// STATISTIC: SourceFilesChecked = 3
// STATISTIC: SourceFilesInferred = 1
// STATISTIC: SourceFilesDemoted = 1

// FILE: main.ts
// A package that ships TypeScript is held to the types it wrote, like the program. A file of a package that has a type error is not: its annotations test nothing, and the build goes on. The other files of the package keep their tests.
import { half as looseHalf } from "loose-package";
import { half as neighborHalf } from "loose-package/neighbor";
import { half as soundHalf } from "sound-package";

const eight: any = "8";
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ":", String(f())); } catch (e) { console.log(label + ":", (e as Error).constructor.name); }
}
attempt("a package without type errors", () => soundHalf(eight));
attempt("a file of a package with a type error", () => looseHalf(eight));
attempt("another file of that package", () => neighborHalf(eight));

// FILE: node_modules/loose-package/index.ts
export const mistyped: number = "text";
export function half(n: number) { return n / 2; }

// FILE: node_modules/loose-package/neighbor.ts
export function half(n: number) { return n / 2; }

// FILE: node_modules/loose-package/package.json
{ "name": "loose-package", "version": "1.0.0", "main": "index.ts", "types": "index.ts" }

// FILE: node_modules/sound-package/index.ts
export function half(n: number) { return n / 2; }

// FILE: node_modules/sound-package/package.json
{ "name": "sound-package", "version": "1.0.0", "main": "index.ts", "types": "index.ts" }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: attempt
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=":"
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = Builtin builtin=String
// CHECK-NEXT: v10 = Call v1 calleeName="f"
// CHECK-NEXT: v11 = Call v9, -, v10 calleeName="String"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v13 = Call v6, v4, v8, v12 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v14 = CatchValue
// CHECK-NEXT: v15 = Builtin builtin=GlobalThis
// CHECK-NEXT: v16 = PropGet v15 key="console" [isFreeName]
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v17 key="log"
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v20 = String string=":"
// CHECK-NEXT: v21 = Add v0, v20
// CHECK-NEXT: v22 = Convert v14 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v23 = PropGet v22 key="constructor"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|function site=[[w_5]]} illTypedCause=Assertion
// CHECK-NEXT: v25 = PropGet v24 key="name"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|string site=[[w_5]]} illTypedCause=Assertion
// CHECK-NEXT: v27 = Call v19, v17, v21, v26 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v28 = Undefined
// CHECK-NEXT: Return v28
// CHECK-NEXT: }
