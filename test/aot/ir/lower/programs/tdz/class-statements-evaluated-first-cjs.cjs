// RUN: lower
// OPTIONS: builtin-modules

// FILE: main.cjs
// `bun run` evaluates the class statements of a CommonJS file whose evaluation runs no code of the program before the other statements of the file.
function attempt(read) { try { return typeof read(); } catch (error) { return error.name; } }
console.log("early", attempt(() => Plain), attempt(() => WithCall), attempt(() => Exported));
exports.early = attempt(() => Plain);
class Plain { static n = 1; m() { return require("node:path").sep; } }
class WithCall { static n = Math.abs(1); }
module.exports.Exported = class Exported {};
class Exported {}
console.log("late", attempt(() => Plain), attempt(() => WithCall), new Plain().m(), exports.early, this === module.exports);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: attempt Plain m
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v1 = Call v0 calleeName="read"
// CHECK-NEXT: v2 = TypeOf v1
// CHECK-NEXT: Return v2
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v3 = CatchValue
// CHECK-NEXT: v4 = PropGet v3 key="name"
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Plain"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="m"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|"/"|"\\" flags=[IsExpected]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = RequireModule module=[[m_4]] referrer=[[m_0]] specifier="node:path"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v2 = PropGet v1 key="sep"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|"/"|"\\" flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
