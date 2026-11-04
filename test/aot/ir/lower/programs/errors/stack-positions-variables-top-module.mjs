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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasExplicitName] length=1 syntax=[HasWrittenAwait] thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
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
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v11 = CatchValue
// CHECK-NEXT: v12 = Builtin builtin=GlobalThis
// CHECK-NEXT: v13 = PropGet v12 key="console" [isFreeName]
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v14 key="log"
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v17 = Builtin builtin=String
// CHECK-NEXT: v18 = PropGet v11 key="stack"
// CHECK-NEXT: v19 = Call v17, -, v18 calleeName="String"
// CHECK-NEXT: v20 = PropGet v19 key="split"
// CHECK-NEXT: v21 = String string="\n"
// CHECK-NEXT: v22 = Call v20, v19, v21 calleeKey="split" calleeName="split"
// CHECK-NEXT: v23 = PropGet v22 key="map"
// CHECK-NEXT: v24 = NewClosure function=[[f_1]]
// CHECK-NEXT: v25 = Call v23, v22, v24 calleeKey="map" calleeName="map"
// CHECK-NEXT: v26 = PropGet v25 key="filter"
// CHECK-NEXT: v27 = NewClosure function=[[f_2]]
// CHECK-NEXT: v28 = Call v26, v25, v27 calleeKey="filter" calleeName="filter"
// CHECK-NEXT: v29 = PropGet v28 key="map"
// CHECK-NEXT: v30 = NewClosure function=[[f_3]]
// CHECK-NEXT: v31 = Call v29, v28, v30 calleeKey="map" calleeName="map"
// CHECK-NEXT: v32 = PropGet v31 key="join"
// CHECK-NEXT: v33 = String string=" < "
// CHECK-NEXT: v34 = Call v32, v31, v33 calleeKey="join" calleeName="join"
// CHECK-NEXT: v35 = Call v16, v14, v34 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v36 = Undefined
// CHECK-NEXT: Return v36
// CHECK-NEXT: }
