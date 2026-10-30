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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="a"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|"a" flags=[IsExpected]}
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="b"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|"b" flags=[IsExpected]}
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v12 = CheckInitialized v11 name="c"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|"c" flags=[IsExpected]}
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v15 = CheckInitialized v14 name="d"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|"d" flags=[IsExpected]}
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v18 = CheckInitialized v17 name="e"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|"e" flags=[IsExpected]}
// CHECK-NEXT: v20 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v21 = CheckInitialized v20 name="f"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|"f" flags=[IsExpected]}
// CHECK-NEXT: v23 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v24 = CheckInitialized v23 name="g"
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|"g" flags=[IsExpected]}
// CHECK-NEXT: v26 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v27 = CheckInitialized v26 name="h"
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|"h" flags=[IsExpected]}
// CHECK-NEXT: v29 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v30 = CheckInitialized v29 name="i"
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|"i" flags=[IsExpected]}
// CHECK-NEXT: v32 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v33 = CheckInitialized v32 name="j"
// CHECK-NEXT: v34 = Convert v33 declared={type=undefined|null|"j" flags=[IsExpected]}
// CHECK-NEXT: v35 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v36 = CheckInitialized v35 name="k"
// CHECK-NEXT: v37 = Convert v36 declared={type=undefined|null|"k" flags=[IsExpected]}
// CHECK-NEXT: v38 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v39 = CheckInitialized v38 name="l"
// CHECK-NEXT: v40 = Convert v39 declared={type=undefined|null|"l" flags=[IsExpected]}
// CHECK-NEXT: v41 = NewArray v7, v10, v13, v16, v19, v22, v25, v28, v31, v34, v37, v40 contents=undefined|null|string
// CHECK-NEXT: v42 = Convert v41 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v43 = PropGet v42 key="join"
// CHECK-NEXT: v44 = Convert v43 declared={type=undefined|null|[[f_13]] flags=[IsExpected]}
// CHECK-NEXT: v45 = String string=""
// CHECK-NEXT: v46 = Call v44, v42, v45 calleeKey="join" calleeName="join"
// CHECK-NEXT: v47 = Convert v46 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v48 = Call v4, v2, v47 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v49 = Builtin builtin=GlobalThis
// CHECK-NEXT: v50 = PropGet v49 key="console" [isFreeName]
// CHECK-NEXT: v51 = Convert v50 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v52 = PropGet v51 key="log"
// CHECK-NEXT: v53 = Convert v52 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v54 = GetModuleVariable variable=[[g_14]]
// CHECK-NEXT: v55 = CheckInitialized v54 name="log"
// CHECK-NEXT: v56 = Convert v55 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v57 = PropGet v56 key="join"
// CHECK-NEXT: v58 = Convert v57 declared={type=undefined|null|[[f_13]] flags=[IsExpected]}
// CHECK-NEXT: v59 = String string="\n"
// CHECK-NEXT: v60 = Call v58, v56, v59 calleeKey="join" calleeName="log.join"
// CHECK-NEXT: v61 = Convert v60 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v62 = Call v53, v51, v61 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v63 = Undefined
// CHECK-NEXT: Return v63
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
