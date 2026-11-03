// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 5

// FILE: main.ts
// Whether a private member is unused is a question of the file that declares it, under its own tsconfig.json. A read by name in a file of another project, which is checked first because the two import each other, counts there whatever that project reports.
import { Holder } from "./reports/holder";
import { Control } from "./reports/control";

console.log(new Holder().show(), new Control().show());

// FILE: lenient/peek.ts
import type { Holder } from "../reports/holder";

export function peek(holder: Holder): number {
  return holder["hidden"];
}

// FILE: reports/control.ts
import { peekControl } from "./peek-control";

export class Control {
  private hidden = 2;
  show(): number {
    return peekControl(this);
  }
}

// FILE: reports/holder.ts
import { peek } from "../lenient/peek";

export class Holder {
  private hidden = 1;
  show(): number {
    return peek(this);
  }
}

// FILE: reports/peek-control.ts
import type { Control } from "./control";

export function peekControl(control: Control): number {
  return control["hidden"];
}

// FILE: lenient/tsconfig.json
{
  "extends": "../tsconfig.json"
}

// FILE: reports/tsconfig.json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "noUnusedLocals": true
  }
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="Holder"
// CHECK-NEXT: v7 = Construct v6 calleeName="Holder"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[L_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=UnprovenCallee
// CHECK-NEXT: v9 = PropGet v8 key="show"
// CHECK-NEXT: v10 = Call v9, v8 calleeKey="show" calleeName="show"
// CHECK-NEXT: v11 = Convert v10 declared={type=number site=[[w_3]]}
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v13 = CheckInitialized v12 name="Control"
// CHECK-NEXT: v14 = Construct v13 calleeName="Control"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[L_5]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=UnprovenCallee
// CHECK-NEXT: v16 = PropGet v15 key="show"
// CHECK-NEXT: v17 = Call v16, v15 calleeKey="show" calleeName="show"
// CHECK-NEXT: v18 = Convert v17 declared={type=number site=[[w_6]]}
// CHECK-NEXT: v19 = Call v4, v2, v11, v18 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v20 = Undefined
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
