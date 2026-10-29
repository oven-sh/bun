// RUN: lower
// OPTIONS: builtin-modules

// `import * as ns from "bun"; export { ns }` exports the global `Bun` object, to importers and in the namespace object of the exporter. `export * as ns from "bun"` exports a module namespace object.
import * as held from "bun";
export { held };
export * as namespace from "bun";
import * as self from "./bun-namespace-import-exported.js";
import { held as importedHeld, namespace as importedNamespace } from "./bun-namespace-import-exported.js";

const read = (object, name) => object[name];
const tag = value => Object.prototype.toString.call(value);

console.log("held:", held === Bun, importedHeld === Bun, self.held === Bun, read(self, "held") === Bun);
console.log("namespace:", importedNamespace === Bun, self.namespace === Bun, read(self, "namespace") === Bun);
console.log("namespace:", tag(importedNamespace), importedNamespace === self.namespace, importedNamespace === read(self, "namespace"), importedNamespace.default === Bun);
console.log(Object.keys(self).join(" "));

// GENERATED: read tag
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=2 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}, {type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: undefined|null|object, v1: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = ElemGet v0, v1
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="tag"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=ObjectPrototypeToString
// CHECK-NEXT: v2 = PropGet v1 key="call"
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(FunctionPrototypeCall) flags=[IsExpected]}
// CHECK-NEXT: v4 = Call v3, v1, v0 calleeKey="call" calleeName="Object.prototype.toString.call"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=undefined|null|string flags=[IsExpected]}}]
// CHECK-NEXT: }
