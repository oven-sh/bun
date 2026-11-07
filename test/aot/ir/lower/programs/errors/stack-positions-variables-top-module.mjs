// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 12

// FILE: main.mjs
// Imports modules in which the value of a variable at the top is converted by code that throws, and prints the frames of each error.
async function show(load) {
  try {
    await load();
    console.log("no error");
  } catch (error) {
    console.log(
      String(error.stack)
        .split("\n")
        .map(text => /^\s*at (.*?) ?\(?[^ ()]*[\/\\]([\w.-]+):(\d+):(\d+)\)?$/.exec(text))
        .filter(found => found !== null)
        .map(found => found[1] + "@" + found[2] + ":" + found[3] + ":" + found[4])
        .join(" < "),
    );
  }
}
await show(() => import("./constant.mjs"));
await show(() => import("./variable.mjs"));
await show(() => import("./exported-constant.mjs"));
await show(() => import("./method-in-the-literal.mjs"));
await show(() => import("./handed-to-string.mjs"));
await show(() => import("./added.mjs"));
await show(() => import("./var-variable.mjs"));
await show(() => import("./read-by-a-function.mjs"));
await show(() => import("./behind-another-constant.mjs"));
await show(() => import("./behind-a-literal.mjs"));

// FILE: added.mjs
import { fail } from "./fail.mjs";
const atTop = 1 + { valueOf: () => fail() };

// FILE: behind-a-literal.mjs
import { fail } from "./fail.mjs";
const holder = { toString: () => String(fail()) };
const atTop = `a${1}${holder}`;

// FILE: behind-another-constant.mjs
import { fail } from "./fail.mjs";
const holder = { toString: () => String(fail()) };
const atTop = `${holder}`.length;

// FILE: constant.mjs
import { fail } from "./fail.mjs";
const atTop = `${{ toString: () => String(fail()) }}`.length;

// FILE: exported-constant.mjs
import { fail } from "./fail.mjs";
export const atTop = `${{ toString: () => String(fail()) }}`.length;

// FILE: fail.mjs
export function fail() {
  throw new Error("fail");
}

// FILE: handed-to-string.mjs
import { fail } from "./fail.mjs";
const atTop = String({ toString: () => String(fail()) });

// FILE: method-in-the-literal.mjs
import { fail } from "./fail.mjs";
const atTop = `${{
  toString() {
    return String(fail());
  },
}}`.length;

// FILE: read-by-a-function.mjs
import { fail } from "./fail.mjs";
const atTop = `${{ toString: () => String(fail()) }}`.length;
export function reads() {
  return atTop;
}

// FILE: var-variable.mjs
import { fail } from "./fail.mjs";
var atTop = `${{ toString: () => String(fail()) }}`.length;

// FILE: variable.mjs
import { fail } from "./fail.mjs";
let atTop = `${{ toString: () => String(fail()) }}`.length;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: show
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=undefined|null|Promise flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Call v1 calleeName="load"
// CHECK-NEXT: v3 = Await v2, v1
// CHECK-NEXT: v4 = Builtin builtin=GlobalThis
// CHECK-NEXT: v5 = PropGet v4 key="console" [isFreeName]
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v7 = PropGet v6 key="log"
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v9 = String string="no error"
// CHECK-NEXT: v10 = Call v8, v6, v9 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v11 = CatchValue
// CHECK-NEXT: v12 = Builtin builtin=GlobalThis
// CHECK-NEXT: v13 = PropGet v12 key="console" [isFreeName]
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v14 key="log"
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v17 = Builtin builtin=String
// CHECK-NEXT: v18 = PropGet v11 key="stack"
// CHECK-NEXT: v19 = Call v17, -, v18 calleeName="String"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v21 = PropGet v20 key="split"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: v23 = String string="\n"
// CHECK-NEXT: v24 = Call v22, v20, v23 calleeKey="split" calleeName="split"
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v26 = PropGet v25 key="map"
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v28 = NewClosure function=[[f_3]]
// CHECK-NEXT: v29 = Call v27, v25, v28 calleeKey="map" calleeName="map"
// CHECK-NEXT: v30 = Convert v29 declared={type=undefined|null|Array<undefined|null|Array<undefined|null|string>> flags=[IsExpected]}
// CHECK-NEXT: v31 = PropGet v30 key="filter"
// CHECK-NEXT: v32 = Convert v31 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v33 = NewClosure function=[[f_5]]
// CHECK-NEXT: v34 = Call v32, v30, v33 calleeKey="filter" calleeName="filter"
// CHECK-NEXT: v35 = Convert v34 declared={type=undefined|null|Array<undefined|null|Array<undefined|null|string>> flags=[IsExpected]}
// CHECK-NEXT: v36 = PropGet v35 key="map"
// CHECK-NEXT: v37 = Convert v36 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v38 = NewClosure function=[[f_6]]
// CHECK-NEXT: v39 = Call v37, v35, v38 calleeKey="map" calleeName="map"
// CHECK-NEXT: v40 = Convert v39 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v41 = PropGet v40 key="join"
// CHECK-NEXT: v42 = Convert v41 declared={type=undefined|null|[[f_7]] flags=[IsExpected]}
// CHECK-NEXT: v43 = String string=" < "
// CHECK-NEXT: v44 = Call v42, v40, v43 calleeKey="join" calleeName="join"
// CHECK-NEXT: v45 = Convert v44 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v46 = Call v16, v14, v45 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v47 = Undefined
// CHECK-NEXT: Return v47
// CHECK-NEXT: }
