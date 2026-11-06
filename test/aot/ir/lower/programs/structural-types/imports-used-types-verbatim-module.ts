// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 5

// FILE: main.ts
// Imports used only as types under verbatim module syntax.
import { log } from "./log";
import type { Shape as A } from "./whole-type";
import { type Shape as B } from "./inline-type";
import { type Model as C, type Shape as D } from "./named-type";
import type E from "./default-type";
import { type Shape as F, value } from "./mixed";
import type * as G from "./namespace-type";
import type { Shape as H } from "./again";
import "./bare";
import { value as neverUsed } from "./unused-value";
import NeverUsed from "./unused-default";
import * as neverUsedEither from "./unused-namespace";
import { Model } from "./used";

const a: A = { sides: 1 };
const b: B = { sides: 2 };
const c: C = { sides: 3 };
const d: D = { sides: 4 };
const e: E = { name: "e" };
const f: F = { sides: 6 };
const g: G.Shape = { sides: 7 };
const h: H = { sides: 8 };

console.log("modules that ran: " + log.join(", "));
console.log([a.sides, b.sides, c.sides, d.sides, e.name, f.sides, g.sides, h.sides, value, new Model().sides].join(" "));
console.log("c is a Model of another module: " + (c instanceof Model));

// FILE: again.ts
import { log } from "./log";

log.push("again ran");

export type { Shape } from "./exported-again";
export { type Model } from "./exported-again";

// FILE: bare.ts
import { log } from "./log";

log.push("bare ran");

export interface Shape {
  sides: number;
}

export class Model {
  sides = 4;
}

export const value = "bare";

export default class Main {
  name = "bare";
}

// FILE: default-type.ts
import { log } from "./log";

log.push("default-type ran");

export interface Shape {
  sides: number;
}

export class Model {
  sides = 4;
}

export const value = "default-type";

export default class Main {
  name = "default-type";
}

// FILE: exported-again.ts
import { log } from "./log";

log.push("exported-again ran");

export interface Shape {
  sides: number;
}

export class Model {
  sides = 4;
}

export const value = "exported-again";

export default class Main {
  name = "exported-again";
}

// FILE: inline-type.ts
import { log } from "./log";

log.push("inline-type ran");

export interface Shape {
  sides: number;
}

export class Model {
  sides = 4;
}

export const value = "inline-type";

export default class Main {
  name = "inline-type";
}

// FILE: log.ts
export const log: string[] = [];

// FILE: mixed.ts
import { log } from "./log";

log.push("mixed ran");

export interface Shape {
  sides: number;
}

export class Model {
  sides = 4;
}

export const value = "mixed";

export default class Main {
  name = "mixed";
}

// FILE: named-type.ts
import { log } from "./log";

log.push("named-type ran");

export interface Shape {
  sides: number;
}

export class Model {
  sides = 4;
}

export const value = "named-type";

export default class Main {
  name = "named-type";
}

// FILE: namespace-type.ts
import { log } from "./log";

log.push("namespace-type ran");

export interface Shape {
  sides: number;
}

export class Model {
  sides = 4;
}

export const value = "namespace-type";

export default class Main {
  name = "namespace-type";
}

// FILE: unused-default.ts
import { log } from "./log";

log.push("unused-default ran");

export const value = "unused-default";

export default class Main {
  name = "unused-default";
}

// FILE: unused-namespace.ts
import { log } from "./log";

log.push("unused-namespace ran");

export const value = "unused-namespace";

export default class Main {
  name = "unused-namespace";
}

// FILE: unused-value.ts
import { log } from "./log";

log.push("unused-value ran");

export const value = "unused-value";

export default class Main {
  name = "unused-value";
}

// FILE: used.ts
import { log } from "./log";

log.push("used ran");

export interface Shape {
  sides: number;
}

export class Model {
  sides = 4;
}

export const value = "used";

export default class Main {
  name = "used";
}

// FILE: whole-type.ts
import { log } from "./log";

log.push("whole-type ran");

export interface Shape {
  sides: number;
}

export class Model {
  sides = 4;
}

export const value = "whole-type";

export default class Main {
  name = "whole-type";
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "verbatimModuleSyntax": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v2 = Data data=[[d_4]]
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[L_2]] site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v4 = Data data=[[d_6]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_2]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v6 = Data data=[[d_8]]
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[L_2]] site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v8 = Data data=[[d_10]]
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|[[L_11]] site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v10 = Data data=[[d_13]]
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[L_2]] site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v12 = Data data=[[d_15]]
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[L_2]] site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v14 = Data data=[[d_17]]
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[L_2]] site=[[w_18]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v16 = Builtin builtin=GlobalThis
// CHECK-NEXT: v17 = PropGet v16 key="console" [isFreeName]
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v18 key="log"
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v21 = String string="modules that ran: "
// CHECK-NEXT: v22 = GetModuleVariable variable=[[g_19]]
// CHECK-NEXT: v23 = CheckInitialized v22 name="log"
// CHECK-NEXT: v24 = PropGet v23 key="join"
// CHECK-NEXT: v25 = String string=", "
// CHECK-NEXT: v26 = Call v24, v23, v25 calleeKey="join" calleeName="log.join"
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|string site=[[w_20]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v28 = Add v21, v27
// CHECK-NEXT: v29 = Call v20, v18, v28 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v30 = Builtin builtin=GlobalThis
// CHECK-NEXT: v31 = PropGet v30 key="console" [isFreeName]
// CHECK-NEXT: v32 = Convert v31 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v33 = PropGet v32 key="log"
// CHECK-NEXT: v34 = Convert v33 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v35 = PropGet v1 key="sides"
// CHECK-NEXT: v36 = PropGet v3 key="sides"
// CHECK-NEXT: v37 = PropGet v5 key="sides"
// CHECK-NEXT: v38 = PropGet v7 key="sides"
// CHECK-NEXT: v39 = PropGet v9 key="name"
// CHECK-NEXT: v40 = PropGet v11 key="sides"
// CHECK-NEXT: v41 = PropGet v13 key="sides"
// CHECK-NEXT: v42 = PropGet v15 key="sides"
// CHECK-NEXT: v43 = GetModuleVariable variable=[[g_21]]
// CHECK-NEXT: v44 = CheckInitialized v43 name="value"
// CHECK-NEXT: v45 = GetModuleVariable variable=[[g_22]]
// CHECK-NEXT: v46 = CheckInitialized v45 name="Model"
// CHECK-NEXT: v47 = Construct v46 calleeName="Model"
// CHECK-NEXT: v48 = Convert v47 declared={type=undefined|null|[[L_23]] site=[[w_24]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=UnprovenCallee
// CHECK-NEXT: v49 = PropGet v48 key="sides"
// CHECK-NEXT: v50 = NewArray v35, v36, v37, v38, v39, v40, v41, v42, v44, v49 contents=undefined|null|number|string
// CHECK-NEXT: v51 = PropGet v50 key="join"
// CHECK-NEXT: v52 = String string=" "
// CHECK-NEXT: v53 = Call v51, v50, v52 calleeKey="join" calleeName="join"
// CHECK-NEXT: v54 = Convert v53 declared={type=undefined|null|string site=[[w_25]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v55 = Call v34, v32, v54 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v56 = Builtin builtin=GlobalThis
// CHECK-NEXT: v57 = PropGet v56 key="console" [isFreeName]
// CHECK-NEXT: v58 = Convert v57 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v59 = PropGet v58 key="log"
// CHECK-NEXT: v60 = Convert v59 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v61 = String string="c is a Model of another module: "
// CHECK-NEXT: v62 = GetModuleVariable variable=[[g_22]]
// CHECK-NEXT: v63 = CheckInitialized v62 name="Model"
// CHECK-NEXT: v64 = InstanceOf v5, v63 writtenExpression="c instanceof Model"
// CHECK-NEXT: v65 = Add v61, v64
// CHECK-NEXT: v66 = Call v60, v58, v65 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v67 = Undefined
// CHECK-NEXT: Return v67
// CHECK-NEXT: }
