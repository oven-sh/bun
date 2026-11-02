// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 6

// FILE: main.tsx
// "sideEffects": false, and each import of the package has one use that is no plain identifier: a JSX tag, a member tag, the factory of a pragma, a decorator, a shorthand property, an export clause and a heritage clause. `bun run` also prints "unused.js is evaluated". `bun build --compile` leaves that file out, and --aot follows it.
/* @jsxRuntime classic */
/* @jsx h */
import { h, Tag, mark, shorthand, reexported, Base } from "odd";
import * as odd from "odd";
import * as self from "./main";

export { reexported };

@mark
class Derived extends Base {}

console.log(<Tag />, <odd.MemberTag />);
console.log({ shorthand }.shorthand(), self.reexported(), new Derived().method(), (Derived as any).marked);

// FILE: node_modules/odd/base.js
export class Base { method() { return "method of Base"; } }

// FILE: node_modules/odd/functions.js
export function shorthand() { return "shorthand"; }
export function reexported() { return "exported again"; }

// FILE: node_modules/odd/h.js
export function h(tag) { return typeof tag === "function" ? tag() : tag; }

// FILE: node_modules/odd/index.d.ts
declare global { namespace JSX { interface IntrinsicElements { [name: string]: any } } }
export function h(tag: any, props: any, ...children: any[]): any;
export function Tag(): any;
export function MemberTag(): any;
export function mark(value: Function, context: ClassDecoratorContext): void;
export function shorthand(): string;
export function reexported(): string;
export class Base { method(): string }

// FILE: node_modules/odd/index.js
export { h } from "./h.js";
export { Tag, MemberTag } from "./tags.js";
export { mark } from "./mark.js";
export { shorthand, reexported } from "./functions.js";
export { Base } from "./base.js";
export { unused } from "./unused.js";

// FILE: node_modules/odd/mark.js
export function mark(value) { value.marked = "marked"; }

// FILE: node_modules/odd/package.json
{ "name": "odd", "version": "1.0.0", "type": "module", "main": "index.js", "types": "index.d.ts", "sideEffects": false }

// FILE: node_modules/odd/tags.js
export function Tag() { return "tag"; }
export function MemberTag() { return "member tag"; }

// FILE: node_modules/odd/unused.js
console.log("unused.js is evaluated");
export function unused() { return "unused"; }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="mark"
// CHECK-NEXT: v2 = NewArray v1 contents=anything
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="Base"
// CHECK-NEXT: v5 = ResolveHeritage v4
// CHECK-NEXT: v6 = NewClosure function=[[f_3]]
// CHECK-NEXT: v7 = NewClass v6, v4, v5 layout=[[L_4]]
// CHECK-NEXT: PutModuleVariable v7 variable=[[g_5]]
// CHECK-NEXT: v9 = FinishClass v7 layout=[[L_4]]
// CHECK-NEXT: v10 = Builtin builtin=CompilerHelpersCreateDecoratorMetadata [isNotReadFromHolder]
// CHECK-NEXT: v11 = Call v10, -, v4
// CHECK-NEXT: v12 = NewArray contents=anything
// CHECK-NEXT: v13 = String string="Derived"
// CHECK-NEXT: v14 = Builtin builtin=CompilerHelpersApplyClassDecorators [isNotReadFromHolder]
// CHECK-NEXT: v15 = Call v14, -, v2, v9, v13, v11, v12
// CHECK-NEXT: v16 = Builtin builtin=CompilerHelpersRunInitializers [isNotReadFromHolder]
// CHECK-NEXT: v17 = Call v16, -, v12, v15
// CHECK-NEXT: v18 = Builtin builtin=GlobalThis
// CHECK-NEXT: v19 = PropGet v18 key="console" [isFreeName]
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v21 = PropGet v20 key="log"
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v23 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v24 = CheckInitialized v23 name="h"
// CHECK-NEXT: v25 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v26 = CheckInitialized v25 name="Tag"
// CHECK-NEXT: v27 = Null
// CHECK-NEXT: v28 = Call v24, -, v26, v27 calleeName="h"
// CHECK-NEXT: v29 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v30 = CheckInitialized v29 name="h"
// CHECK-NEXT: v31 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v32 = CheckInitialized v31 name="MemberTag"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|[[f_9]] flags=[IsExpected]}
// CHECK-NEXT: v34 = Null
// CHECK-NEXT: v35 = Call v30, -, v33, v34 calleeName="h"
// CHECK-NEXT: v36 = Call v22, v20, v28, v35 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v37 = Builtin builtin=GlobalThis
// CHECK-NEXT: v38 = PropGet v37 key="console" [isFreeName]
// CHECK-NEXT: v39 = Convert v38 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v40 = PropGet v39 key="log"
// CHECK-NEXT: v41 = Convert v40 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v42 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v43 = CheckInitialized v42 name="shorthand"
// CHECK-NEXT: v44 = Convert v43 declared={type=undefined|null|[[f_11]] flags=[IsExpected]}
// CHECK-NEXT: v45 = NewObject layout=[[L_12]]
// CHECK-NEXT: PropDefine v45, v44 key="shorthand"
// CHECK-NEXT: v47 = FinishObject v45
// CHECK-NEXT: v48 = PropGet v47 key="shorthand"
// CHECK-NEXT: v49 = Call v48, v47 calleeKey="shorthand" calleeName="shorthand"
// CHECK-NEXT: v50 = Convert v49 declared={type=undefined|null|string site=[[w_13]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v51 = GetModuleVariable variable=[[g_14]]
// CHECK-NEXT: v52 = CheckInitialized v51 name="reexported"
// CHECK-NEXT: v53 = ModuleNamespace module=[[m_0]]
// CHECK-NEXT: v54 = Convert v53 declared={type=undefined|null|object} illTypedCause=Assertion
// CHECK-NEXT: v55 = Call v52, v54 calleeName="self.reexported"
// CHECK-NEXT: v56 = Convert v55 declared={type=undefined|null|string site=[[w_15]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v57 = Convert v15 declared={type=undefined|null|[[f_16]]} illTypedCause=Assertion
// CHECK-NEXT: v58 = Construct v57 calleeName="Derived"
// CHECK-NEXT: v59 = Convert v58 declared={type=undefined|null|[[L_4]] site=[[w_17]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=UnprovenCallee
// CHECK-NEXT: v60 = PropGet v59 key="method"
// CHECK-NEXT: v61 = Call v60, v59 calleeKey="method" calleeName="method"
// CHECK-NEXT: v62 = Convert v61 declared={type=undefined|null|string site=[[w_17]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v63 = Convert v57 declared={type=undefined|null|number|string|symbol|bigint|[[L_18]] flags=[IsExpected]}
// CHECK-NEXT: v64 = PropGet v63 key="marked"
// CHECK-NEXT: v65 = Call v41, v39, v50, v56, v62, v64 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v66 = Undefined
// CHECK-NEXT: Return v66
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Derived"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_16]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_4]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
