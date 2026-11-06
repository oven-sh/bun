// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 7

// FILE: main.ts
// What `import lib = require()` binds is read by name, by a computed name, in a pattern, given away, exported again and used after new and extends.
import byName = require("./by-name");
import byComputed = require("./by-computed");
import byPattern = require("./by-pattern");
import givenAway = require("./given-away");
import classes = require("./classes");
export import exportedAgain = require("./exported-again");
import * as self from "./main";

console.log(byName.target());
console.log((byComputed as any)["tar" + "get"]());
const { target } = byPattern;
console.log(target());
function call(lib: { target(): string }) { return lib.target(); }
console.log(call(givenAway));
class Derived extends classes.Base {}
console.log(new Derived().method(), new classes.Other().method());
console.log(self.exportedAgain.target());

// FILE: by-computed.ts
export function target() { return "by a computed name"; }

// FILE: by-name.ts
export function target() { return "by name"; }
export function unused() { return "unused"; }

// FILE: by-pattern.ts
export function target() { return "by a pattern"; }

// FILE: classes.ts
export class Base { method() { return "method of Base"; } }
export class Other { method() { return "method of Other"; } }

// FILE: exported-again.ts
export function target() { return "exported again"; }

// FILE: given-away.ts
export function target() { return "given away"; }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: call Derived
// CHECK-LABEL: function {{*}}name="call"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="target"
// CHECK-NEXT: v2 = Call v1, v0 calleeKey="target" calleeName="lib.target"
// CHECK-NEXT: ReturnCall v2 casts=[{declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Derived"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_6]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_6]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
