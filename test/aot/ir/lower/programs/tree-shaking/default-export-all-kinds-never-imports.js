// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 14

// FILE: main.js
// Each file has a default export and a named one; only the named one is imported. The default is a literal, an object, an array, a name, a function, a class, an arrow function, a call, a marked call, a conditional, a template, a `new`. Those that do something do it. `bun run` also makes the marked call; `bun build --compile` does not.
import { log } from "./log.js";
import { named as a } from "./kinds/literal.js";
import { named as b } from "./kinds/object.js";
import { named as c } from "./kinds/name.js";
import { named as d } from "./kinds/function.js";
import { named as e } from "./kinds/class.js";
import { named as f } from "./kinds/arrow.js";
import { named as g } from "./kinds/call.js";
import { named as h } from "./kinds/marked-call.js";
import { named as i } from "./kinds/conditional.js";
import { named as j } from "./kinds/new.js";
import { named as k } from "./kinds/class-with-static.js";
import { named as l } from "./kinds/object-with-call.js";

console.log([a, b, c, d, e, f, g, h, i, j, k, l].join(""));
console.log(log.join("\n"));

// FILE: kinds/arrow.js
export const named = "f";
export default () => "never";

// FILE: kinds/call.js
import { effect } from "../log.js";
export const named = "g";
export default effect("a call");

// FILE: kinds/class-with-static.js
import { effect } from "../log.js";
export const named = "k";
export default class { static field = effect("a static field"); }

// FILE: kinds/class.js
export const named = "e";
export default class { method() { return "never"; } }

// FILE: kinds/conditional.js
import { effect, log } from "../log.js";
export const named = "i";
export default log.length >= 0 ? effect("an arm of a conditional") : 0;

// FILE: kinds/function.js
export const named = "d";
export default function () { return "never"; }

// FILE: kinds/literal.js
export const named = "a";
export default 5;

// FILE: kinds/marked-call.js
import { effect } from "../log.js";
export const named = "h";
export default /* @__PURE__ */ effect("a marked call");

// FILE: kinds/name.js
export const named = "c";
const local = { only: "the default names this" };
export default local;

// FILE: kinds/new.js
import { effect } from "../log.js";
export const named = "j";
export default new (class { constructor() { effect("a constructor"); } })();

// FILE: kinds/object-with-call.js
import { effect } from "../log.js";
export const named = "l";
export default { value: effect("a call inside an object") };

// FILE: kinds/object.js
export const named = "b";
export default { a: 1, list: [1, 2], nested: { deep: true } };

// FILE: log.js
export const log = [];
export const effect = name => { log.push(name); return name; };

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="a"
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="b"
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="c"
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v12 = CheckInitialized v11 name="d"
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v14 = CheckInitialized v13 name="e"
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v16 = CheckInitialized v15 name="f"
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v18 = CheckInitialized v17 name="g"
// CHECK-NEXT: v19 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v20 = CheckInitialized v19 name="h"
// CHECK-NEXT: v21 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v22 = CheckInitialized v21 name="i"
// CHECK-NEXT: v23 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v24 = CheckInitialized v23 name="j"
// CHECK-NEXT: v25 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v26 = CheckInitialized v25 name="k"
// CHECK-NEXT: v27 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v28 = CheckInitialized v27 name="l"
// CHECK-NEXT: v29 = NewArray v6, v8, v10, v12, v14, v16, v18, v20, v22, v24, v26, v28 contents=anything
// CHECK-NEXT: v30 = String string="abcdefghijkl"
// CHECK-NEXT: v31 = Call v4, v2, v30 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v32 = Builtin builtin=GlobalThis
// CHECK-NEXT: v33 = PropGet v32 key="console" [isFreeName]
// CHECK-NEXT: v34 = Convert v33 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v35 = PropGet v34 key="log"
// CHECK-NEXT: v36 = Convert v35 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v37 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v38 = CheckInitialized v37 name="log"
// CHECK-NEXT: v39 = PropGet v38 key="join"
// CHECK-NEXT: v40 = String string="\n"
// CHECK-NEXT: v41 = Call v39, v38, v40 calleeKey="join" calleeName="log.join"
// CHECK-NEXT: v42 = Call v36, v34, v41 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v43 = Undefined
// CHECK-NEXT: Return v43
// CHECK-NEXT: }
